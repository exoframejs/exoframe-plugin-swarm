exports.startFromParams = async ({
  docker,
  serverConfig,
  name,
  image,
  deploymentName,
  projectName,
  username,
  backendName,
  frontend,
  hostname,
  restartPolicy,
  serviceLabels,
  Env = [],
  Mounts = [],
  additionalNetworks = [],
}) => {
  // construct restart policy
  const Condition = ['none', 'on-failure', 'any'].find(c => c.startsWith(restartPolicy));
  const RestartPolicy = {Condition, MaxAttempts: 1};
  if (restartPolicy.includes('on-failure')) {
    let restartCount = 2;
    try {
      restartCount = parseInt(restartPolicy.split(':')[1], 10);
    } catch (e) {
      // error parsing restart count, using default value
    }
    RestartPolicy.Condition = 'on-failure';
    RestartPolicy.MaximumRetryCount = restartCount;
  }

  // get network from config
  const {network: userNetwork} = serverConfig.plugins.swarm;
  const network = userNetwork || 'exoframe-swarm';
  const swarmLabels = {'traefik.port': '80', 'traefik.docker.network': network};
  const Labels = Object.assign({}, serviceLabels, swarmLabels);

  // create service config
  const serviceConfig = {
    Name: name,
    Labels,
    TaskTemplate: {
      ContainerSpec: {
        Image: image,
        Env,
        Mounts,
      },
      Resources: {
        Limits: {},
        Reservations: {},
      },
      RestartPolicy,
      Placement: {},
    },
    Mode: {
      Replicated: {
        Replicas: 1,
      },
    },
    UpdateConfig: {
      Parallelism: 2, // allow 2 instances to run at the same time
      Delay: 10000000000, // 10s
      Order: 'start-first', // start new instance first, then remove old one
    },
    Networks: [
      ...additionalNetworks.map(networkName => ({
        Target: networkName,
      })),
      {
        Target: network,
        Aliases: hostname && hostname.length ? [hostname] : [],
      },
    ],
  };

  // create service
  const service = await docker.createService(serviceConfig);
  return service.inspect();
};

exports.start = async ({
  config,
  serverConfig,
  project,
  username,
  name,
  image,
  Env,
  serviceLabels,
  writeStatus,
  resultStream,
  docker,
}) => {
  // construct restart policy
  const restartPolicy = config.restart || 'on-failure:2';
  const Condition = ['none', 'on-failure', 'any'].find(c => c.startsWith(restartPolicy));
  const RestartPolicy = {Condition, MaxAttempts: 1};
  if (restartPolicy.includes('on-failure')) {
    let restartCount = 2;
    try {
      restartCount = parseInt(restartPolicy.split(':')[1], 10);
    } catch (e) {
      // error parsing restart count, using default value
    }
    RestartPolicy.Condition = 'on-failure';
    RestartPolicy.MaximumRetryCount = restartCount;
  }

  // get network from config
  const {network: userNetwork} = serverConfig.plugins.swarm;
  const network = userNetwork || 'exoframe-swarm';
  const swarmLabels = {'traefik.port': '80', 'traefik.docker.network': network};
  const Labels = Object.assign({}, serviceLabels, swarmLabels);

  // create service config
  const serviceConfig = {
    Name: name,
    Labels,
    TaskTemplate: {
      ContainerSpec: {
        Image: image,
        Env,
      },
      Resources: {
        Limits: {},
        Reservations: {},
      },
      RestartPolicy,
      Placement: {},
    },
    Mode: {
      Replicated: {
        Replicas: 1,
      },
    },
    UpdateConfig: {
      Parallelism: 2, // allow 2 instances to run at the same time
      Delay: 10000000000, // 10s
      Order: 'start-first', // start new instance first, then remove old one
    },
    Networks: [
      {
        Target: network,
        Aliases: config.hostname && config.hostname.length ? [config.hostname] : [],
      },
    ],
  };

  // try to find existing service
  // get all current services
  const oldServices = await docker.listServices();
  // find services for current user and project
  const existing = oldServices.filter(
    c => c.Spec.Labels['exoframe.user'] === username && c.Spec.Labels['exoframe.project'] === project
  );
  const existingService = existing.find(
    s => s.Spec.Labels['exoframe.project'] === project && s.Spec.TaskTemplate.ContainerSpec.Image === image
  );
  if (existingService) {
    // assign required vars from existing services
    serviceConfig.version = parseInt(existingService.Version.Index, 10);
    serviceConfig.Name = existingService.Spec.Name;
    serviceConfig.TaskTemplate.ForceUpdate = 1;

    writeStatus(resultStream, {message: 'Updating serivce with following config:', serviceConfig, level: 'verbose'});

    // update service
    const service = docker.getService(existingService.ID);
    await service.update(serviceConfig);

    writeStatus(resultStream, {message: 'Service successfully updated!', level: 'verbose'});

    return service.inspect();
  }

  writeStatus(resultStream, {message: 'Starting serivce with following config:', serviceConfig, level: 'verbose'});

  // create service
  const service = await docker.createService(serviceConfig);

  writeStatus(resultStream, {message: 'Service successfully started!', level: 'verbose'});

  return service.inspect();
};
