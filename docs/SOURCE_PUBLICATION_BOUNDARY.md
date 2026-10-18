# Source publication boundary

Source contains Arnall's product and synthetic examples. Operational identities,
configuration, credentials and company-specific instructions are external data.

Backend CI checks tracked source and commit metadata before building. Its
operator-managed `SOURCE_BOUNDARY_POLICY` contains salted digests rather than
environment names. Missing or invalid policy blocks publication. The checker
reports file paths without printing matching content.

After a history replacement, preserve unpublished work as a local backup and
patch, make a fresh clone, then reapply only reviewed changes. Do not merge or
push old history. Existing PR references and cached views are managed separately
by GitHub and are not erased by replacing branches.
