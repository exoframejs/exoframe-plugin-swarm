const removeService = async ({docker, serviceInfo}) => {
  const service = docker.getService(serviceInfo.ID);
  try {
    await service.remove();
  } catch (e) {
    // ignore not found errors
    if (e.statusCode === 404) {
      return;
    }
    throw e;
  }
};

// removal of swarm services
module.exports = async ({docker, username, id, reply}) => {
  // look for normal containers
  const allServices = await docker.listServices();
  const serviceInfo = allServices.find(c => c.Spec.Labels['exoframe.user'] === username && c.Spec.Name === id);

  // if container found by name - remove
  if (serviceInfo) {
    await removeService({serviceInfo, docker});
    reply.code(204).send('removed');
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
  // remove all
  await Promise.all(services.map(serviceInfo => removeService({serviceInfo, docker})));
  // reply
  reply.code(204).send('removed');
};
