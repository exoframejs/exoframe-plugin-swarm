/* eslint-env jest */
// mock path for testing
jest.mock('path');
jest.mock('child_process');
// npm packages
const path = require('path');
const tar = require('tar-fs');
const rimraf = require('rimraf');
const Docker = require('dockerode');
const getPort = require('get-port');

// our packages
const authToken = require('./fixtures/authToken');
const {start} = require('exoframe-server');

// create new docker instance
const docker = new Docker(); // defaults to above if env variables are not used

// promisifies rimraf
const rimrafAsync = p => new Promise(r => rimraf(p, r));
// util sleep function
const sleep = t => new Promise(r => setTimeout(r, t));

// create tar streams
const streamDocker = tar.pack(path.join(__dirname, 'fixtures', 'docker-project'));
const streamNode = tar.pack(path.join(__dirname, 'fixtures', 'node-project'));
const streamHtml = tar.pack(path.join(__dirname, 'fixtures', 'html-project'));
const streamHtmlUpdate = tar.pack(path.join(__dirname, 'fixtures', 'html-project'));
const streamCompose = tar.pack(path.join(__dirname, 'fixtures', 'compose-v3-project'));
const streamComposeUpdate = tar.pack(path.join(__dirname, 'fixtures', 'compose-v3-project'));
const streamBrokenCompose = tar.pack(path.join(__dirname, 'fixtures', 'compose-project'));
const streamBrokenDocker = tar.pack(path.join(__dirname, 'fixtures', 'broken-docker-project'));
const streamBrokenNode = tar.pack(path.join(__dirname, 'fixtures', 'broken-node-project'));
const streamAdditionalLabels = tar.pack(path.join(__dirname, 'fixtures', 'additional-labels'));
const streamTemplate = tar.pack(path.join(__dirname, 'fixtures', 'template-project'));

// options base
const postOptionsBase = {
  method: 'POST',
  url: '/deploy',
  headers: {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/octet-stream',
  },
};

// options base
const getOptionsBase = {
  method: 'GET',
  url: '/list',
  headers: {
    Authorization: `Bearer ${authToken}`,
  },
};

// name of default swarm network
const exoframeNetworkSwarm = 'exoframe-swarm';

// storage vars
let fastify;
let simpleHtmlInitialDeploy = '';
let composeDeployOne = '';
let composeDeployTwo = '';
let htmlServiceInfo = {};
let nodeServiceInfo = {};

// set timeout to 120s
jest.setTimeout(120000);

beforeAll(async done => {
  // remove any installed plugins
  await rimrafAsync(path.join(__dirname, 'fixtures', 'config', 'plugins', 'node_modules'));
  // start new instance of fastify
  const port = await getPort();
  fastify = await start(port);

  done();
});

afterAll(async done => {
  const allServices = await docker.listServices();
  await Promise.all(allServices.map(serviceInfo => docker.getService(serviceInfo.ID).remove()));

  fastify.close();
  done();
});

test('Should deploy simple docker project to swarm', async done => {
  const options = Object.assign(postOptionsBase, {
    payload: streamDocker,
  });

  const response = await fastify.inject(options);
  // parse result into lines
  const result = response.payload
    .split('\n')
    .filter(l => l && l.length)
    .map(line => JSON.parse(line));

  // find deployments
  const completeDeployments = result.find(it => it.deployments && it.deployments.length).deployments;

  // check response
  expect(response.statusCode).toEqual(200);
  expect(completeDeployments.length).toEqual(1);

  // check name
  const name = completeDeployments[0].Spec.Name;
  expect(name.startsWith('exo-admin-test-docker-deploy-')).toBeTruthy();

  // check docker services
  const allServices = await docker.listServices();
  const serviceInfo = allServices.find(c => c.Spec.Name === name);

  expect(serviceInfo).toBeDefined();
  expect(serviceInfo.Spec.Labels['exoframe.deployment']).toEqual(name);
  expect(serviceInfo.Spec.Labels['exoframe.user']).toEqual('admin');
  expect(serviceInfo.Spec.Labels['exoframe.project']).toEqual('test-project');
  expect(serviceInfo.Spec.Labels['traefik.backend']).toEqual(`${name}.test`);
  expect(serviceInfo.Spec.Labels['traefik.docker.network']).toEqual(exoframeNetworkSwarm);
  expect(serviceInfo.Spec.Labels['traefik.enable']).toEqual('true');
  expect(serviceInfo.Spec.Networks.length).toEqual(1);
  expect(serviceInfo.Spec.Networks[0].Aliases.includes('test')).toBeTruthy();
  expect(serviceInfo.Spec.TaskTemplate.RestartPolicy).toMatchObject({Condition: 'none', MaxAttempts: 1});

  // cleanup
  const instance = docker.getService(serviceInfo.ID);
  await instance.remove();

  done();
});

test('Should deploy simple node project to swarm', async done => {
  const options = Object.assign(postOptionsBase, {
    payload: streamNode,
  });

  const response = await fastify.inject(options);
  // parse result into lines
  const result = response.payload
    .split('\n')
    .filter(l => l && l.length)
    .map(line => JSON.parse(line));

  // find deployments
  const completeDeployments = result.find(it => it.deployments && it.deployments.length).deployments;

  // check response
  expect(response.statusCode).toEqual(200);
  expect(completeDeployments.length).toEqual(1);

  // check name
  const name = completeDeployments[0].Spec.Name;
  expect(name.startsWith('exo-admin-test-node-deploy-')).toBeTruthy();

  // check docker services
  const allServices = await docker.listServices();
  const serviceInfo = allServices.find(c => c.Spec.Name === name);
  const deployId = name
    .split('-')
    .slice(-1)
    .shift();

  expect(serviceInfo).toBeDefined();
  expect(serviceInfo.Spec.Labels['exoframe.deployment']).toEqual(name);
  expect(serviceInfo.Spec.Labels['exoframe.user']).toEqual('admin');
  expect(serviceInfo.Spec.Labels['exoframe.project']).toEqual(name.replace(`-${deployId}`, ''));
  expect(serviceInfo.Spec.Labels['traefik.backend']).toEqual('localhost');
  expect(serviceInfo.Spec.Labels['traefik.docker.network']).toEqual(exoframeNetworkSwarm);
  expect(serviceInfo.Spec.Labels['traefik.enable']).toEqual('true');
  expect(serviceInfo.Spec.Labels['traefik.frontend.rule']).toEqual('Host:localhost');
  expect(serviceInfo.Spec.Networks.length).toEqual(1);

  // cleanup
  nodeServiceInfo = serviceInfo;

  // wait for service to start
  while (true) {
    await sleep(2000);
    const containers = await docker.listContainers();
    const deployed = containers.find(c => c.Labels['com.docker.swarm.service.id'] === serviceInfo.ID);
    if (deployed) {
      // once container is available - sleep for a couple more seconds
      // to let the node inside start
      await sleep(2000);
      break;
    }
  }

  done();
});

test('Should get logs for current deployment from swarm', async done => {
  const serviceName = nodeServiceInfo.Spec.Labels['exoframe.deployment'];
  const options = Object.assign({}, getOptionsBase, {
    url: `/logs/${serviceName}`,
  });

  const response = await fastify.inject(options);
  // console.log(response);
  // check response
  expect(response.statusCode).toEqual(200);
  // check logs
  const lines = response.payload
    // split by lines
    .split('\n')
    // remove unicode chars
    .map(line => line.replace(/^\u0001.+?\d/, '').replace(/\n+$/, ''))
    // filter blank lines
    .filter(line => line && line.length > 0)
    // remove timestamps
    .map(line => {
      const parts = line.split(/\dZ\s/);
      return parts[1].replace(/\sv\d.+/, ''); // strip any versions
    });
  expect(lines).toMatchSnapshot();

  done();
});

test('Should remove current deployment from swarm', async done => {
  const serviceName = nodeServiceInfo.Spec.Labels['exoframe.deployment'];
  const options = Object.assign({}, postOptionsBase, {
    url: `/remove/${serviceName}`,
    payload: {},
  });

  const response = await fastify.inject(options);
  // check response
  expect(response.statusCode).toEqual(204);

  // check docker services
  const allServices = await docker.listServices();
  const exService = allServices.find(c => c.Spec.Name === serviceName);
  expect(exService).toBeUndefined();

  done();
});

test('Should return error when removing nonexistent project from swarm', async done => {
  // options base
  const options = Object.assign({}, postOptionsBase, {
    url: `/remove/do-not-exist`,
    payload: {},
  });

  const response = await fastify.inject(options);
  const result = JSON.parse(response.payload);
  // check response
  expect(response.statusCode).toEqual(404);
  expect(result).toMatchObject({error: 'Service not found!'});
  done();
});

test('Should deploy simple HTML project to swarm', async done => {
  const options = Object.assign(postOptionsBase, {
    payload: streamHtml,
  });

  const response = await fastify.inject(options);
  // parse result into lines
  const result = response.payload
    .split('\n')
    .filter(l => l && l.length)
    .map(line => JSON.parse(line));

  // find deployments
  const completeDeployments = result.find(it => it.deployments && it.deployments.length).deployments;

  // check response
  expect(response.statusCode).toEqual(200);
  expect(completeDeployments.length).toEqual(1);
  // check name
  const name = completeDeployments[0].Spec.Name;
  expect(name.startsWith('exo-admin-test-html-deploy-')).toBeTruthy();

  // check docker services
  const allServices = await docker.listServices();
  const serviceInfo = allServices.find(c => c.Spec.Name === name);

  expect(serviceInfo).toBeDefined();
  expect(serviceInfo.Spec.Labels['exoframe.deployment']).toEqual(name);
  expect(serviceInfo.Spec.Labels['exoframe.user']).toEqual('admin');
  expect(serviceInfo.Spec.Labels['exoframe.project']).toEqual('simple-html');
  expect(serviceInfo.Spec.Labels['traefik.backend']).toEqual(name);
  expect(serviceInfo.Spec.Labels['traefik.docker.network']).toEqual(exoframeNetworkSwarm);
  expect(serviceInfo.Spec.Labels['traefik.enable']).toEqual('true');
  expect(serviceInfo.Spec.Labels['traefik.frontend.rule']).toBeUndefined();
  expect(serviceInfo.Spec.Networks.length).toEqual(1);

  // store initial deploy id
  simpleHtmlInitialDeploy = serviceInfo.ID;
  htmlServiceInfo = serviceInfo.Spec;

  done();
});

test('Should list deployed projects in swarm', async done => {
  const response = await fastify.inject(getOptionsBase);
  const result = JSON.parse(response.payload);

  // check response
  expect(response.statusCode).toEqual(200);
  expect(result.services).toBeDefined();
  expect(result.containers).toBeDefined();
  expect(result.services.length).toEqual(1);

  // check container info
  const service = result.services.find(c => c.Spec.Name === htmlServiceInfo.Name);
  expect(service).toBeDefined();
  expect(service.Spec.Labels['exoframe.deployment']).toEqual(htmlServiceInfo.Labels['exoframe.deployment']);
  expect(service.Spec.Labels['exoframe.user']).toEqual(htmlServiceInfo.Labels['exoframe.user']);
  expect(service.Spec.Labels['traefik.backend']).toEqual(htmlServiceInfo.Labels['traefik.backend']);
  expect(service.Spec.Labels['traefik.frontend.rule']).toEqual(htmlServiceInfo.Labels['traefik.frontend.rule']);

  done();
});

test('Should update simple HTML project in swarm', async done => {
  const options = Object.assign(postOptionsBase, {
    url: '/update',
    payload: streamHtmlUpdate,
  });

  const response = await fastify.inject(options);
  // parse result into lines
  const result = response.payload
    .split('\n')
    .filter(l => l && l.length)
    .map(line => JSON.parse(line));

  // find deployments
  const completeDeployments = result.find(it => it.deployments && it.deployments.length).deployments;

  // check response
  expect(response.statusCode).toEqual(200);
  expect(completeDeployments.length).toEqual(1);
  const name = completeDeployments[0].Spec.Name;
  expect(name.startsWith('exo-admin-test-html-deploy-')).toBeTruthy();

  // check docker services
  const allServices = await docker.listServices();
  const serviceInfo = allServices.find(c => c.Spec.Name === name);

  expect(serviceInfo).toBeDefined();
  expect(serviceInfo.ID).toEqual(simpleHtmlInitialDeploy);
  expect(serviceInfo.Spec.Labels['exoframe.user']).toEqual('admin');
  expect(serviceInfo.Spec.Labels['exoframe.project']).toEqual('simple-html');
  expect(serviceInfo.Spec.Labels['traefik.docker.network']).toEqual(exoframeNetworkSwarm);
  expect(serviceInfo.Spec.Labels['traefik.enable']).toEqual('true');
  expect(serviceInfo.Spec.Labels['traefik.frontend.rule']).toBeUndefined();
  expect(serviceInfo.Spec.Networks.length).toEqual(1);

  // cleanup
  const instance = docker.getService(serviceInfo.ID);
  await instance.remove();

  done();
});

test('Should deploy simple compose project to swarm', async done => {
  const options = Object.assign(postOptionsBase, {
    payload: streamCompose,
  });

  const response = await fastify.inject(options);
  // parse result into lines
  const result = response.payload
    .split('\n')
    .filter(l => l && l.length)
    .map(line => JSON.parse(line));

  // find deployments
  const completeDeployments = result.find(it => it.deployments && it.deployments.length).deployments;

  // check response
  expect(response.statusCode).toEqual(200);
  expect(completeDeployments.length).toEqual(2);

  // check names
  const nameOne = completeDeployments[0].Spec.Name;
  const nameTwo = completeDeployments[1].Spec.Name;
  expect(nameOne).toEqual('exo-admin-test-compose-swarm-deploy_web');
  expect(nameTwo).toEqual('exo-admin-test-compose-swarm-deploy_redis');

  // check docker services
  const allServices = await docker.listServices();
  const serviceOne = allServices.find(c => c.Spec.Name === nameOne);
  const serviceTwo = allServices.find(c => c.Spec.Name === nameTwo);

  expect(serviceOne).toBeDefined();
  expect(serviceTwo).toBeDefined();
  expect(serviceOne.Spec.Labels['exoframe.deployment'].startsWith(nameOne.replace('_web', ''))).toBeTruthy();
  expect(serviceTwo.Spec.Labels['exoframe.deployment'].startsWith(nameTwo.replace('_redis', ''))).toBeTruthy();
  expect(serviceOne.Spec.Labels['exoframe.user']).toEqual('admin');
  expect(serviceTwo.Spec.Labels['exoframe.user']).toEqual('admin');
  expect(serviceOne.Spec.Labels['exoframe.project']).toEqual(nameOne.replace('_web', ''));
  expect(serviceTwo.Spec.Labels['exoframe.project']).toEqual(nameTwo.replace('_redis', ''));
  expect(serviceOne.Spec.Labels['traefik.backend']).toEqual(nameOne.replace('_web', '-web'));
  expect(serviceTwo.Spec.Labels['traefik.backend']).toEqual(nameTwo.replace('_redis', '-redis'));
  expect(serviceOne.Spec.Labels['traefik.docker.network']).toEqual(exoframeNetworkSwarm);
  expect(serviceTwo.Spec.Labels['traefik.docker.network']).toEqual(exoframeNetworkSwarm);
  expect(serviceOne.Spec.Labels['traefik.enable']).toEqual('true');
  expect(serviceTwo.Spec.Labels['traefik.enable']).toEqual('true');
  expect(serviceOne.Spec.Labels['traefik.frontend.rule']).toEqual('Host:test.dev');
  expect(serviceOne.Spec.TaskTemplate.Networks.length).toEqual(2);
  expect(serviceTwo.Spec.TaskTemplate.Networks.length).toEqual(2);

  // store ids for update test
  composeDeployOne = serviceOne.Id;
  composeDeployTwo = serviceTwo.Id;

  done();
});

test('Should update simple compose project in swarm', async done => {
  const options = Object.assign(postOptionsBase, {
    url: '/update',
    payload: streamComposeUpdate,
  });

  const response = await fastify.inject(options);
  // parse result into lines
  const result = response.payload
    .split('\n')
    .filter(l => l && l.length)
    .map(line => JSON.parse(line));

  // find deployments
  const completeDeployments = result.find(it => it.deployments && it.deployments.length).deployments;

  // check response
  expect(response.statusCode).toEqual(200);
  expect(completeDeployments.length).toEqual(2);

  // check names
  const nameOne = completeDeployments[0].Spec.Name;
  const nameTwo = completeDeployments[1].Spec.Name;
  expect(nameOne).toEqual('exo-admin-test-compose-swarm-deploy_web');
  expect(nameTwo).toEqual('exo-admin-test-compose-swarm-deploy_redis');

  // check docker services
  const allServices = await docker.listServices();
  const serviceOne = allServices.find(c => c.Spec.Name === nameOne);
  const serviceTwo = allServices.find(c => c.Spec.Name === nameTwo);

  expect(serviceOne).toBeDefined();
  expect(serviceTwo).toBeDefined();
  expect(serviceOne.Spec.Labels['exoframe.deployment'].startsWith(nameOne.replace('_web', '-web'))).toBeTruthy();
  expect(serviceTwo.Spec.Labels['exoframe.deployment'].startsWith(nameTwo.replace('_redis', '-redis'))).toBeTruthy();
  expect(serviceOne.Spec.Labels['exoframe.user']).toEqual('admin');
  expect(serviceTwo.Spec.Labels['exoframe.user']).toEqual('admin');
  expect(serviceOne.Spec.Labels['exoframe.project']).toEqual(nameOne.replace('_web', ''));
  expect(serviceTwo.Spec.Labels['exoframe.project']).toEqual(nameTwo.replace('_redis', ''));
  expect(serviceOne.Spec.Labels['traefik.backend']).toEqual(nameOne.replace('_web', '-web'));
  expect(serviceTwo.Spec.Labels['traefik.backend']).toEqual(nameTwo.replace('_redis', '-redis'));
  expect(serviceOne.Spec.Labels['traefik.docker.network']).toEqual(exoframeNetworkSwarm);
  expect(serviceTwo.Spec.Labels['traefik.docker.network']).toEqual(exoframeNetworkSwarm);
  expect(serviceOne.Spec.Labels['traefik.enable']).toEqual('true');
  expect(serviceTwo.Spec.Labels['traefik.enable']).toEqual('true');
  expect(serviceOne.Spec.Labels['traefik.frontend.rule']).toEqual('Host:test.dev');
  expect(serviceOne.Spec.TaskTemplate.Networks.length).toEqual(2);
  expect(serviceTwo.Spec.TaskTemplate.Networks.length).toEqual(2);

  // get old containers
  expect(serviceOne.ID).not.toEqual(composeDeployOne);
  expect(serviceTwo.ID).not.toEqual(composeDeployTwo);

  done();
});

test('Should get logs for current project from swarm', async done => {
  const projectName = 'exo-admin-test-compose-swarm-deploy';
  // options base
  const options = Object.assign({}, getOptionsBase, {
    url: `/logs/${projectName}`,
  });

  const response = await fastify.inject(options);
  // check response
  expect(response.statusCode).toEqual(200);

  // check logs
  const text = response.payload
    // split by lines
    .split('\n')
    // remove unicode chars
    .map(line => line.replace(/^\u0001.+?\d/, '').replace(/\n+$/, ''))
    // filter blank lines
    .filter(line => line && line.length > 0)
    // remove timestamps
    .map(line => {
      if (line.startsWith('Logs for')) {
        return line;
      }
      const parts = line.split(/\dZ\s/);
      return parts[1].replace(/\sv\d.+/, ''); // strip any versions
    });
  expect(text).toEqual(
    expect.arrayContaining([
      'Logs for exo-admin-test-compose-swarm-deploy_redis',
      'Logs for exo-admin-test-compose-swarm-deploy_web',
    ])
  );

  done();
});

test('Should not get logs for nonexistent project', async done => {
  // options base
  const options = Object.assign({}, getOptionsBase, {
    url: `/logs/do-not-exist`,
  });

  const response = await fastify.inject(options);
  const result = JSON.parse(response.payload);
  // check response
  expect(response.statusCode).toEqual(404);
  expect(result).toMatchObject({error: 'Service not found!'});
  done();
});

test('Should remove current project from swarm', async done => {
  // compose project
  const projectName = 'exo-admin-test-compose-swarm-deploy';
  // options base
  const options = Object.assign({}, postOptionsBase, {
    url: `/remove/${projectName}`,
    payload: {},
  });

  const response = await fastify.inject(options);
  // check response
  expect(response.statusCode).toEqual(204);

  // check docker services
  const allServices = await docker.listServices();
  const prjServices = allServices.filter(c => c.Spec.Labels['exoframe.project'] === projectName);
  expect(prjServices.length).toEqual(0);

  done();
});

test('Should display error log for broken docker project in swarm', async done => {
  const options = Object.assign(postOptionsBase, {
    payload: streamBrokenDocker,
  });

  const response = await fastify.inject(options);
  // parse result into lines
  const result = response.payload
    .split('\n')
    .filter(l => l && l.length)
    .map(line => JSON.parse(line));

  // get last error
  const error = result.pop();

  // check response
  expect(response.statusCode).toEqual(200);
  expect(error.message).toEqual('Build failed! See build log for details.');
  expect(error.log[0].includes('Step 1/3 : FROM busybox')).toBeTruthy();
  expect(error.log.find(l => l.includes('Step 2/3 : RUN exit 1'))).toBeDefined();
  expect(error.log[error.log.length - 1]).toEqual("The command '/bin/sh -c exit 1' returned a non-zero code: 1");

  done();
});

test('Should display error log for broken Node.js project in swarm', async done => {
  const options = Object.assign(postOptionsBase, {
    payload: streamBrokenNode,
  });

  const response = await fastify.inject(options);
  // parse result into lines
  const result = response.payload
    .split('\n')
    .filter(l => l && l.length)
    .map(line => JSON.parse(line));

  // get last error
  const error = result.pop();

  // check response
  expect(response.statusCode).toEqual(200);
  expect(error.message).toEqual('Build failed! See build log for details.');
  expect(error.log[0].includes('Step 1/8 : FROM node:latest')).toBeTruthy();
  expect(error.log.find(l => l.includes('Step 2/8 : RUN mkdir -p /usr/src/app'))).toBeDefined();
  expect(error.log[error.log.length - 1]).toEqual(
    "The command '/bin/sh -c npm install --silent' returned a non-zero code: 1"
  );

  done();
});

test('Should display error log for compose v2 project in swarm', async done => {
  const options = Object.assign(postOptionsBase, {
    payload: streamBrokenCompose,
  });

  const response = await fastify.inject(options);
  // parse result into lines
  const result = response.payload
    .split('\n')
    .filter(l => l && l.length)
    .map(line => JSON.parse(line));

  // get last error
  const error = result.pop();

  // check response
  expect(response.statusCode).toEqual(200);
  expect(error.message).toEqual('Running in swarm mode, can only deploy docker-compose file of version 3!');

  done();
});

test('Should have additional labels in swarm', async done => {
  const options = Object.assign(postOptionsBase, {
    payload: streamAdditionalLabels,
  });

  const response = await fastify.inject(options);
  // parse result into lines
  const result = response.payload
    .split('\n')
    .filter(l => l && l.length)
    .map(line => JSON.parse(line));

  // find deployments
  const completeDeployments = result.find(it => it.deployments && it.deployments.length).deployments;

  // check response
  expect(response.statusCode).toEqual(200);

  // check docker services
  const allServices = await docker.listServices();
  const serviceInfo = allServices.find(c => c.Spec.Name === completeDeployments[0].Spec.Name);
  expect(serviceInfo).toBeDefined();
  expect(serviceInfo.Spec.Labels['custom.label']).toEqual('additional-label');

  // cleanup
  const instance = docker.getService(serviceInfo.ID);
  await instance.remove();

  done();
});

test('Should deploy project with configured template to swarm', async done => {
  const options = Object.assign(postOptionsBase, {
    payload: streamTemplate,
  });

  const response = await fastify.inject(options);
  // parse result into lines
  const result = response.payload
    .split('\n')
    .filter(l => l && l.length)
    .map(line => JSON.parse(line));

  // find deployments
  const completeDeployments = result.find(it => it.deployments && it.deployments.length).deployments;

  // check response
  expect(response.statusCode).toEqual(200);
  expect(completeDeployments.length).toEqual(1);
  expect(result[0]).toEqual({message: 'Deploying Static HTML project..', level: 'info'});

  // check docker services
  const allServices = await docker.listServices();
  const name = completeDeployments[0].Spec.Name;
  const serviceInfo = allServices.find(c => c.Spec.Name === name);
  expect(name.startsWith('exo-admin-test-static-deploy-')).toBeTruthy();

  // extract deploy id
  const deployId = name
    .split('-')
    .slice(-1)
    .shift();

  expect(serviceInfo).toBeDefined();
  expect(serviceInfo.Spec.Labels['exoframe.deployment']).toEqual(name);
  expect(serviceInfo.Spec.Labels['exoframe.user']).toEqual('admin');
  expect(serviceInfo.Spec.Labels['exoframe.project']).toEqual(name.replace(`-${deployId}`, ''));
  expect(serviceInfo.Spec.Labels['traefik.backend']).toEqual('localhost');
  expect(serviceInfo.Spec.Labels['traefik.docker.network']).toEqual(exoframeNetworkSwarm);
  expect(serviceInfo.Spec.Labels['traefik.enable']).toEqual('true');
  expect(serviceInfo.Spec.Labels['traefik.frontend.rule']).toEqual('Host:localhost');
  expect(serviceInfo.Spec.Networks.length).toEqual(1);

  // cleanup
  const instance = docker.getService(serviceInfo.ID);
  await instance.remove();

  done();
});
