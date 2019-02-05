module.exports = async ({docker, username, config}) => {
  // get swarm services
  const allServices = await docker.listServices();
  const userServices = await Promise.all(
    allServices
      .filter(s => s.Spec.Labels['exoframe.user'] === username)
      .filter(s => s.Spec.Name !== config.traefikName)
      .map(s => docker.getService(s.ID))
      .map(s => s.inspect())
  );

  return {services: userServices};
};
