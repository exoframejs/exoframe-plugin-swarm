const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');

// async simple sleep function
const sleep = time => new Promise(r => setTimeout(r, time));

// function to update compose file with pre-built images for stack deploy
const updateComposeForStack = ({composePath, baseName, serverConfig, images, yaml}) => {
  // read compose file
  const compose = yaml.safeLoad(fs.readFileSync(composePath, 'utf8'));

  // get network from config
  const nonSwarmNetwork = serverConfig.exoframeNetwork;
  const {network: userNetwork} = serverConfig.plugins.swarm;
  const network = userNetwork || 'exoframe-swarm';

  // modify networks
  compose.networks = Object.assign(
    {},
    {
      [network]: {
        external: true,
      },
    },
    compose.networks
  );
  // remove non-swarm network
  delete compose.networks[nonSwarmNetwork];

  // modify services
  Object.keys(compose.services).forEach(svcKey => {
    // generate docker image name
    const svcImage = `${baseName}_${svcKey}:latest`;
    // also try to check for name match without - symbols
    // some docker engines seem to remove it?
    const svcImageNonKebab = svcImage.replace(/-/g, '');
    // if service has build entry, replace it with image
    if (compose.services[svcKey].build) {
      delete compose.services[svcKey].build;
      compose.services[svcKey].image = images.find(image => image === svcImage || image === svcImageNonKebab);
    }
    // swap network to swarm one
    const networks = Array.from(
      new Set([network, ...compose.services[svcKey].networks.filter(net => net !== nonSwarmNetwork)])
    );
    compose.services[svcKey] = Object.assign({}, compose.services[svcKey], {networks});
    // update network label & move labels to deploy subkey
    const extLabels = {
      'traefik.docker.network': network,
    };
    if (!compose.services[svcKey].deploy) {
      compose.services[svcKey].deploy = {};
    }
    compose.services[svcKey].deploy.labels = Object.assign(
      {},
      compose.services[svcKey].deploy.labels,
      compose.services[svcKey].labels,
      extLabels
    );
    delete compose.services[svcKey].labels;
  });

  // write new compose back to file
  fs.writeFileSync(composePath, yaml.safeDump(compose), 'utf8');

  return compose;
};

// function to execute docker stack deploy using compose file and return the output
const executeStack = ({cmd, resultStream, tempDockerDir, folder, writeStatus}) =>
  new Promise(resolve => {
    const dc = spawn('docker', cmd, {cwd: path.join(tempDockerDir, folder)});

    dc.stdout.on('data', data => {
      const message = data.toString().replace(/\n$/, '');
      const hasError = message.toLowerCase().includes('error') || message.toLowerCase().includes('failed');
      writeStatus(resultStream, {message, level: hasError ? 'error' : 'info'});
    });
    dc.stderr.on('data', data => {
      const message = data.toString().replace(/\n$/, '');
      const hasError = message.toLowerCase().includes('error') || message.toLowerCase().includes('failed');
      writeStatus(resultStream, {message, level: hasError ? 'error' : 'info'});
    });
    dc.on('exit', code => {
      writeStatus(resultStream, {message: `Docker stack deploy exited with code ${code.toString()}`, level: 'info'});
      resolve(code.toString());
    });
  });

module.exports = async ({
  images,
  composePath,
  baseName,
  docker,
  util,
  serverConfig,
  resultStream,
  tempDockerDir,
  folder,
  yaml,
}) => {
  // read compose file
  const compose = yaml.safeLoad(fs.readFileSync(composePath, 'utf8'));
  if (typeof compose.version === 'string' && !compose.version.startsWith('3')) {
    util.logger.debug('Compose file should be of version 3!');
    util.writeStatus(resultStream, {
      message: 'Running in swarm mode, can only deploy docker-compose file of version 3!',
      data: compose,
      level: 'error',
    });
    resultStream.end('');
    return true;
  }

  // update docker-compose to include pre-built images
  const stackCompose = await updateComposeForStack({composePath, baseName, serverConfig, images, yaml});
  util.logger.debug('Compose modified for stack deployment:', stackCompose);
  util.writeStatus(resultStream, {
    message: 'Compose file modified for stack deploy',
    data: JSON.stringify(stackCompose, null, 2),
    level: 'verbose',
  });

  // execute stack deploy
  const exitCode = await executeStack({
    cmd: ['stack', 'deploy', '-c', 'docker-compose.yml', baseName],
    resultStream,
    tempDockerDir,
    folder,
    writeStatus: util.writeStatus,
  });
  util.logger.debug('Stack deploy executed, exit code:', exitCode);
  if (exitCode !== '0') {
    // return them
    util.writeStatus(resultStream, {message: 'Deployment failed!', exitCode, level: 'error'});
    resultStream.end('');
    return;
  }

  // get service name labels from config
  const composeConfig = yaml.safeLoad(fs.readFileSync(composePath, 'utf8'));
  const serviceNames = Object.keys(composeConfig.services).map(
    svc => composeConfig.services[svc].deploy.labels['exoframe.name']
  );

  // wait for stack to deploy
  while (true) {
    // get services info
    const allServices = await docker.daemon.listServices();
    const startedServices = serviceNames
      .map(name => allServices.find(c => c.Spec.Labels['exoframe.name'] === name))
      .filter(s => !!s);
    if (startedServices.length === serviceNames.length) {
      break;
    }
    await sleep(1000);
  }

  // get services info
  const allServices = await docker.daemon.listServices();
  const deployments = await Promise.all(
    serviceNames
      .map(name => allServices.find(c => c.Spec.Labels['exoframe.name'] === name))
      .map(info => docker.daemon.getService(info.ID))
      .map(service => service.inspect())
  );
  // return them
  util.writeStatus(resultStream, {message: 'Deployment success!', deployments, level: 'info'});
  resultStream.end('');
  return true;
};
