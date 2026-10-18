# Arnall source and release ownership

Arnall/company-qa is maintained from arnautxu/AiBrain. Preserve the deployed
chat, documents, scheduling, connectors, authentication, durable state and
recovery features. Operational configuration and credentials stay on the host.

Backend CI validates the exact source and immutable application and gateway
images. Publication reuses those tested images without rebuilding. Deployment
verifies repository origin, image digests, current readers, data compatibility
and recovery evidence. Keep automatic activation on hold during maintenance.
A source change never authorizes restoring old data over current work. Preserve
the forward-only startup marker and verify the compatible successor.

CI, publication, deployment, health and authenticated live acceptance are
separate gates. Native isolation and document/browser protections stay enabled.
