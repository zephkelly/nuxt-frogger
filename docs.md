Gotchas

Never point the batch reporter to an endpoint on your own server. It is intended for pushing the log files to an external service. A log ingestion endpoint
is automatically created at /api/_frogger/logs and is NOT intended for use by anything but frogger's internal functionality.

If for whatever reason you do need to point the batch reporter to an endpoint on your own server, you can NEVER use a getFrogger() instance on that endpoint,
as this will create a recursive loop. The batch reporter will call the endpoint, which will call getFrogger(), which will call the batch reporter, and so on.