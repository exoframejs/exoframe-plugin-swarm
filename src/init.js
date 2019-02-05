// join swarm network
const joinSwarmNetwork = async ({config, logger, docker}) => {
  const allServices = await docker.listServices();
  // try to find traefik instance
  const exoframeServer = allServices.find(c => c.Spec.Name.startsWith('exoframe-server'));
  // if server found - we're running as docker container
  if (exoframeServer) {
    const {network} = config.plugins.swarm;
    const instance = docker.getService(exoframeServer.ID);
    const instanceInfo = await instance.inspect();
    if (instanceInfo.Spec.Networks && instanceInfo.Spec.Networks.find(n => n.Target === network)) {
      logger.debug('Already joined swarm network, done.');
      return;
    }
    logger.debug('Not joined swarm network, updating..');
    await instance.update({
      Name: instanceInfo.Spec.Name,
      version: parseInt(instanceInfo.Version.Index, 10),
      Labels: instanceInfo.Spec.Labels,
      TaskTemplate: Object.assign({}, instanceInfo.Spec.TaskTemplate, {
        Networks: [
          {
            Target: network,
          },
        ],
      }),
      Networks: [
        {
          Target: network,
        },
      ],
    });
  }
};

const createSwarmNetwork = async ({docker, logger, networkName}) => {
  const nets = await docker.listNetworks();
  let exoNet = nets.find(n => n.Name === networkName);
  if (!exoNet) {
    logger.info(`Exoframe network ${networkName} does not exists, creating...`);
    exoNet = await docker.createNetwork({
      Name: networkName,
      Driver: 'overlay',
    });
  } else {
    exoNet = docker.getNetwork(exoNet.Id);
  }

  return exoNet;
};

// export default function
const init = async ({config, logger, docker}) => {
  // only run if swarm plugin is enabled
  if (!config.plugins || !config.plugins.swarm || !config.plugins.swarm.enabled) {
    return false;
  }

  // get network from config
  const {network: userNetwork} = config.plugins.swarm;
  const network = userNetwork || 'exoframe-swarm';

  // create exoframe network if needed
  await createSwarmNetwork({networkName: network, docker, logger});

  // get all containers
  const allContainers = await docker.listContainers({all: true});
  // try to find traefik instance
  const traefik = allContainers.find(c => c.Names.find(n => n.startsWith(`/${config.traefikName}`)));

  // if traefik exists and running - just join swarm network and return
  if (traefik && !traefik.Status.includes('Exited')) {
    logger.info('Traefik already running, docker init done!');
    joinSwarmNetwork({config, logger, docker});
    return true;
  }

  // if container is exited - remove and recreate
  if (traefik && traefik.Status.startsWith('Exited')) {
    logger.info('Exited traefik instance found, re-creating...');
    const traefikContainer = docker.getContainer(traefik.Id);
    // remove
    await traefikContainer.remove();
  }

  // debug flags
  const debug = ['--debug', '--logLevel=DEBUG'];

  // letsencrypt flags
  const letsencrypt = [
    '--acme',
    `--acme.email=${config.letsencryptEmail}`,
    '--acme.storage=/var/acme/acme.json',
    '--acme.httpchallenge.entrypoint=http',
    '--acme.entrypoint=https',
    '--acme.onhostrule=true',
    '--accesslogsfile=/var/acme/access.log',
    `--entryPoints=Name:https Address::443 TLS ${config.compress ? 'Compress:on' : 'Compress:off'}`,
    `--entryPoints=Name:http Address::80 Redirect.EntryPoint:https ${config.compress ? 'Compress:on' : 'Compress:off'}`,
    '--defaultEntryPoints=https,http',
  ];

  // entrypoints without letsencrypt
  const entrypoints = [
    `--entryPoints=Name:http Address::80 ${config.compress ? 'Compress:on' : 'Compress:off'}`,
    '--defaultEntryPoints=http',
  ];

  // construct swarm command additions
  const Cmd = [
    '-c',
    '/dev/null',
    '--docker',
    '--docker.watch',
    '--docker.swarmmode',
    ...(config.letsencrypt ? letsencrypt : entrypoints),
    ...(config.debug ? debug : []),
    ...(config.traefikArgs || []),
  ];

  const Labels = {
    'exoframe.deployment': 'exo-traefik',
    'exoframe.user': 'admin',
  };

  const RestartPolicy = {
    Name: 'on-failure',
    MaximumRetryCount: 2,
  };

  // if running in swarm mode - run traefik as swarm service
  await docker.createService({
    Name: config.traefikName,
    TaskTemplate: {
      ContainerSpec: {
        Image: config.traefikImage,
        Args: Cmd,
        Labels: Labels,
        Mounts: [
          {
            Source: '/var/run/docker.sock',
            Target: '/var/run/docker.sock',
            Type: 'bind',
          },
        ],
      },
      Resources: {
        Limits: {},
        Reservations: {},
      },
      RestartPolicy: RestartPolicy,
      Placement: {
        Constraints: ['node.role==manager'],
      },
    },
    EndpointSpec: {
      Ports: [
        {
          Protocol: 'tcp',
          PublishedPort: 80,
          TargetPort: 80,
        },
        {
          Protocol: 'tcp',
          PublishedPort: 443,
          TargetPort: 443,
        },
      ],
    },
    Mode: {
      Replicated: {
        Replicas: 1,
      },
    },
    UpdateConfig: {
      Parallelism: 1,
    },
    Networks: [
      {
        Target: network,
      },
    ],
  });

  logger.info('Traefik instance started..');
  // apply auto network join in case we're running in a container
  joinSwarmNetwork({config, logger, docker});
  return true;
};

module.exports = init;
