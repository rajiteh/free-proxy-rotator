const ProxyLists = require('proxy-lists');
const ip = require('ip');
const { promisify } = require('util');
const writeFile = promisify(require('fs').writeFile);
const readFile = promisify(require('fs').readFile);
const exec = promisify(require('child_process').exec);

const PROXY_OPTIONS = {
  countries: ['us'],
  sourcesBlackList: ['kingproxies', 'bitproxies']
};

function renderProxies(proxies) {
  return proxies
    .map((proxy, i) => `  server proxy${i} ${proxy}`) // intentional 2 spaces
    .join('\n');
}

function getConfig(proxies) {
  return `
global
  maxconn 1024
  pidfile ha.pid
  daemon

defaults
  mode http
  maxconn 1024
  option  httplog
  option  dontlognull
  retries 1
  timeout connect 5s
  timeout client 20s
  timeout server 20s

frontend localnodes
  bind *:1339
  mode http
  default_backend proxies

backend proxies
  balance roundrobin
  option http_proxy
${renderProxies(proxies)}
`;
}

function getProxyList() {
  let proxyList = {};
  return new Promise((resolve, reject) => {
    ProxyLists.getProxies(PROXY_OPTIONS)
      .on('data', proxies => {
        proxies.forEach(proxy => {
          if (!ip.isV4Format(proxy.ipAddress)) return;

          const el = `${proxy.ipAddress}:${proxy.port}`;

          proxyList[el] = 0; // if i figure out a good way to ping in node, ping server here
        });
      })
      .on('end', () => resolve(proxyList))
      .on('error', err => reject(err));
  });
}

function sortProxiesByPing(proxies) {
  return Object.keys(proxies).sort((a, b) => proxies[a] - proxies[b]);
}

function getHaproxyPID() {
  return readFile('ha.pid');
}

function startHaproxy() {
  console.log('launching haproxy');
  return exec('haproxy -f haproxy.cfg');
}

function reloadHaproxy() {
  console.log('reloading haproxy');
  return exec('haproxy -sf $(cat ha.pid) -f haproxy.cfg');
}

function killHaproxy() {
  console.log('killing existing haproxy');
  return exec('kill -9 $(cat ha.pid) 2>/dev/null');
}

function saveHaproxyConfig(config) {
  return writeFile('haproxy.cfg', config);
}

async function getAndSaveProxyList() {
  console.log('fetching proxies');
  const proxyList = await getProxyList();
  const keys = Object.keys(proxyList);
  const config = getConfig(keys).slice(0, 4095); // haproxy max servers

  await saveHaproxyConfig(config);
}

function tick() {
  setTimeout(async () => {
    try {
      await getAndSaveProxyList();
      await reloadHaproxy();
    } catch (e) {
      console.warn(e);
    }

    return tick();
  }, 30 * 1000);
}

async function main() {
  try {
    await getAndSaveProxyList();
    // should really be check and kill
    await killHaproxy();
    await startHaproxy();
  } catch (e) {
    console.warn(e);
  }

  tick();
}

main();