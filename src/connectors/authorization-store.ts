import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { connectorFingerprint } from "@/connectors/canonical";
import { ConnectorError, type ConnectorAuthorizationSnapshot } from "@/connectors/contracts";
import { atomicWriteJson } from "@/storage/atomic-file";
import { ResourceLockManager } from "@/storage/resource-lock";
import { ValidationContext, defineVersionedSchema, expectIsoDate, expectStrictRecord, expectString } from "@/storage/schema";
import type { ApprovalLocator } from "@/runtime/approval-store";

type StoredConnectorAuthorization = {
  schemaVersion: 1;
  locator: ApprovalLocator;
  authorization: ConnectorAuthorizationSnapshot;
};

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA = /^[a-f0-9]{64}$/;

function snapshot(value: unknown, context: ValidationContext): ConnectorAuthorizationSnapshot {
  const record = expectStrictRecord(value, [
    "schemaVersion", "principal", "connectorId", "operation", "resourceId", "argsHash",
    "permissionFingerprint", "workspacePolicyFingerprint", "credentialBindingFingerprint",
    "mutating", "preparedAt", "expiresAt", "authorizationFingerprint",
  ], context);
  const principal = expectStrictRecord(record.principal, ["installationId", "userId", "roleId"], context.at("principal"));
  const string = (key: string, maximum = 255) => expectString(record[key], context.at(key), { minLength: 1, maxLength: maximum });
  const fingerprint = (key: string) => expectString(record[key], context.at(key), { minLength: 64, maxLength: 64, pattern: SHA });
  const parsed: ConnectorAuthorizationSnapshot = {
    schemaVersion: record.schemaVersion === 1 ? 1 : context.at("schemaVersion").fail("must be 1"),
    principal: {
      installationId: expectString(principal.installationId, context.at("principal.installationId"), { minLength: 2, maxLength: 63 }),
      userId: expectString(principal.userId, context.at("principal.userId"), { minLength: 36, maxLength: 36 }),
      roleId: principal.roleId === null ? null : expectString(principal.roleId, context.at("principal.roleId"), { minLength: 1, maxLength: 63 }),
    },
    connectorId: string("connectorId", 63),
    operation: string("operation", 63),
    resourceId: record.resourceId === null ? null : expectString(record.resourceId, context.at("resourceId"), { minLength: 1, maxLength: 255 }),
    argsHash: fingerprint("argsHash"),
    permissionFingerprint: fingerprint("permissionFingerprint"),
    workspacePolicyFingerprint: fingerprint("workspacePolicyFingerprint"),
    credentialBindingFingerprint: fingerprint("credentialBindingFingerprint"),
    mutating: typeof record.mutating === "boolean" ? record.mutating : context.at("mutating").fail("must be boolean"),
    preparedAt: expectIsoDate(record.preparedAt, context.at("preparedAt")),
    expiresAt: expectIsoDate(record.expiresAt, context.at("expiresAt")),
    authorizationFingerprint: fingerprint("authorizationFingerprint"),
  };
  const { authorizationFingerprint, ...unsigned } = parsed;
  if (connectorFingerprint(unsigned) !== authorizationFingerprint) {
    context.at("authorizationFingerprint").fail("does not match authorization snapshot");
  }
  return parsed;
}

function locator(value: unknown, context: ValidationContext): ApprovalLocator {
  const record = expectStrictRecord(value, ["installationId", "userId", "threadId", "turnId", "itemId", "approvalId"], context);
  const id = (key: string, maximum = 255) => expectString(record[key], context.at(key), { minLength: 1, maxLength: maximum, pattern: OPAQUE_ID });
  return {
    installationId: id("installationId", 63), userId: id("userId", 63), threadId: id("threadId"),
    turnId: id("turnId"), itemId: id("itemId"), approvalId: id("approvalId"),
  };
}

const storedAuthorizationSchema = defineVersionedSchema<StoredConnectorAuthorization>({
  name: "StoredConnectorAuthorization",
  schemaVersion: 1,
  keys: ["locator", "authorization"],
  parse(record, context) {
    return { schemaVersion: 1, locator: locator(record.locator, context.at("locator")), authorization: snapshot(record.authorization, context.at("authorization")) };
  },
});

function sameLocator(left: ApprovalLocator, right: ApprovalLocator) {
  return left.installationId === right.installationId && left.userId === right.userId &&
    left.threadId === right.threadId && left.turnId === right.turnId && left.itemId === right.itemId && left.approvalId === right.approvalId;
}

function missing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export class FileConnectorAuthorizationStore {
  private readonly root: string;
  private readonly locks: ResourceLockManager;

  constructor(private readonly installationId: string, dataRoot: string) {
    this.root = path.join(path.resolve(dataRoot), "connectors", "authorizations", installationId);
    this.locks = new ResourceLockManager({ rootDirectory: path.join(path.resolve(dataRoot), "connectors", "authorization-locks") });
  }

  private pathFor(locatorValue: ApprovalLocator) {
    if (locatorValue.installationId !== this.installationId) throw new ConnectorError("CONNECTOR_AUTHORIZATION_INSTALLATION_MISMATCH", "Authorization belongs to another installation.");
    return path.join(this.root, locatorValue.userId, `${connectorFingerprint(locatorValue)}.json`);
  }

  private async readExact(locatorValue: ApprovalLocator) {
    const filePath = this.pathFor(locatorValue);
    const metadata = await lstat(filePath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o077) !== 0) {
      throw new ConnectorError("CONNECTOR_AUTHORIZATION_PATH_UNSAFE", "Authorization storage path is unsafe.");
    }
    const stored = storedAuthorizationSchema.parse(JSON.parse(await readFile(filePath, "utf8")) as unknown, filePath);
    if (!sameLocator(stored.locator, locatorValue)) throw new ConnectorError("CONNECTOR_AUTHORIZATION_LOCATOR_MISMATCH", "Stored authorization belongs to another locator.");
    return stored;
  }

  async put(locatorValue: ApprovalLocator, authorization: ConnectorAuthorizationSnapshot) {
    const filePath = this.pathFor(locatorValue);
    return this.locks.withLock(`connector-authorization:${filePath}`, async () => {
      try {
        const existing = await this.readExact(locatorValue);
        if (existing.authorization.authorizationFingerprint !== authorization.authorizationFingerprint) {
          throw new ConnectorError("CONNECTOR_AUTHORIZATION_CONFLICT", "Approval locator already has another authorization.");
        }
        return existing.authorization;
      } catch (error) {
        if (!missing(error)) throw error;
      }
      const stored = storedAuthorizationSchema.parse({ schemaVersion: 1, locator: locatorValue, authorization });
      await atomicWriteJson(filePath, stored, storedAuthorizationSchema, { mode: 0o600 });
      return stored.authorization;
    });
  }

  async read(locatorValue: ApprovalLocator, authorizationFingerprint: string) {
    const filePath = this.pathFor(locatorValue);
    return this.locks.withLock(`connector-authorization:${filePath}`, async () => {
      let stored: StoredConnectorAuthorization;
      try {
        stored = await this.readExact(locatorValue);
      } catch (error) {
        if (missing(error)) throw new ConnectorError("CONNECTOR_AUTHORIZATION_NOT_FOUND", "Connector authorization is not available.");
        throw error;
      }
      if (stored.authorization.authorizationFingerprint !== authorizationFingerprint) {
        throw new ConnectorError("CONNECTOR_AUTHORIZATION_TAMPERED", "Connector authorization fingerprint does not match.");
      }
      return stored.authorization;
    });
  }
}
