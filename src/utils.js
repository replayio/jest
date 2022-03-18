const { spawnSync } = require("child_process");

function defer() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function removeColors(str) {
  return str.replace(/\x1B[[(?);]{0,2}(;?\d)*./g, "");
}

function waitForProcessExit(childProcess) {
  const exitWaiter = defer();
  childProcess.on("exit", (code, signal) => exitWaiter.resolve({ code, signal }));
  return exitWaiter.promise;
}

function findExecutablePath(executable) {
  const { stdout } = spawnSync("which", [executable], { stdio: "pipe" });
  const path = stdout.toString().trim();
  return path.length ? path : null;
}

module.exports = { defer, removeColors, waitForProcessExit, findExecutablePath };
