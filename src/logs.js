const {Readable} = require('stream');

module.exports = async ({docker, _, logsConfig, fixLogStream, username, id, reply, follow}) => {
  const allServices = await docker.listServices();
  const serviceInfo = allServices.find(c => c.Spec.Labels['exoframe.user'] === username && c.Spec.Name === id);

  if (serviceInfo) {
    const service = docker.getService(serviceInfo.ID);
    const logs = await service.logs(logsConfig);
    const logStream = fixLogStream(logs);
    reply.send(logStream);
    return;
  }

  // if not found by name - try to find by project
  const services = allServices.filter(
    c => c.Spec.Labels['exoframe.user'] === username && c.Spec.Labels['exoframe.project'] === id
  );
  if (!services.length) {
    reply.code(404).send({error: 'Service not found!'});
    return;
  }

  // get all log streams and prepend them with service names
  const logRequests = await Promise.all(
    services.map(async cInfo => {
      const container = docker.getService(cInfo.ID);
      const logs = await container.logs(logsConfig);
      const logStream = fixLogStream(logs);
      const name = cInfo.Spec.Name;
      const nameStream = _([`Logs for ${name}\n\n`]);
      return [nameStream, _(logStream)];
    })
  );
  // flatten results
  const allLogsStream = _(logRequests).flatten();
  // send wrapped highland stream as response
  reply.send(new Readable().wrap(allLogsStream));
};
