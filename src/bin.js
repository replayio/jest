const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { removeColors, waitForProcessExit, findExecutablePath } = require("./utils");
const { listAllRecordings, uploadRecording, processRecording } = require("@recordreplay/recordings-cli");
const _ = require('lodash');

main();

async function main() {
  const jestProcess = spawn("jest", ["--colors", ...process.argv.slice(2)], { stdio: "pipe" });

  let output = "";

  jestProcess.stdout.on("data", data => {
    output += data.toString();
    process.stdout.write(data);
  });

  jestProcess.stderr.on("data", data => {
    output += data.toString();
    process.stderr.write(data);
  });

  const { code, signal } = await waitForProcessExit(jestProcess);

  const configuration = loadConfiguration();
  const availableTests = getTestsForRecording(configuration, output);

  // Limit on how many recordings we can create.
  const maxRecordings = configuration.maxRecordings || 10;

  if (availableTests.length > maxRecordings) {
    console.log(`Too many tests to record: ${availableTests.length}, limit is ${maxRecordings}`);
    availableTests.length = maxRecordings;
  }

  const recordingDirectories = [];
  const processingPromises = [];
  for (const test of availableTests) {
    const dir = makeRecordingsDirectory();
    recordingDirectories.push(dir);
    await replayTest(configuration, test, dir, processingPromises);
  }
  await Promise.all(processingPromises);

  recordingDirectories.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));

  process.exit(code || (signal ? 1 : 0));
}

function getTestsForRecording(configuration, output) {
  const lines = removeColors(output).split("\n");
  const tests = new Set();
  for (const line of lines) {
    let match = /^\s*FAIL\s+(.*)/.exec(line);
    if (match) {
      tests.add(match[1]);
    }
    if (configuration.recordAll) {
      match = /^\s*PASS\s+(.*)/.exec(line);
      if (match) {
        tests.add(match[1]);
      }
    }
  }
  const rv = [...tests];
  return configuration.randomize ? _.shuffle(rv) : rv;
}

function makeRecordingsDirectory() {
  const dir = path.join(os.tmpdir(), `recordreplay-cypress-${(Math.random() * 1e9) | 0}`);
  fs.mkdirSync(dir);
  return dir;
}

async function replayTest(configuration, testPath, recordingsDir, processingPromises) {
  function logMessage(prefix, msg) {
    console.log(`replay-jest ${testPath}${prefix ? " " + prefix : ""}: ${msg}`);
  }

  logMessage("", `Creating recording...`);

  function logFailure(why) {
    logMessage("failed", why);
  }

  // Make sure the replay version of node is installed and updated.
  const replayNodePath = findExecutablePath("replay-node");
  if (!replayNodePath) {
    logFailure(`replay-node not available, try "npm i @recordreplay/replay-node-cli -g"`);
    return;
  }
  spawnSync(replayNodePath, ["--update"]);

  // Directory where replay-node will install the node binary.
  const baseReplayDirectory = process.env.RECORD_REPLAY_DIRECTORY || path.join(process.env.HOME, ".replay");
  const replayNodeBinaryPath = path.join(baseReplayDirectory, "node", "node");

  const jestPath = findJestPath();
  if (!jestPath) {
    logFailure(`Could not find jest path`);
    return;
  }

  const apiKey = process.env.RECORD_REPLAY_API_KEY;
  if (!apiKey) {
    logFailure(`RECORD_REPLAY_API_KEY not set`);
    return;
  }

  const recordingOptions = { directory: recordingsDir, apiKey };

  const replayProcess = spawn(
    replayNodeBinaryPath,
    [jestPath, testPath],
    {
      stdio: "pipe",
      env: {
        ...process.env,
        RECORD_REPLAY_DIRECTORY: recordingsDir,
      }
    }
  );

  let output = "";

  replayProcess.stdout.on("data", data => {
    output += data.toString();
  });

  replayProcess.stderr.on("data", data => {
    output += data.toString();
  });

  await waitForProcessExit(replayProcess);

  const availableTests = getTestsForRecording(configuration, output);
  if (!availableTests.length) {
    if (configuration.recordAll) {
      logFailure(`No tests ran while recording`);
    } else {
      logFailure(`Recording process did not have test failures`);
    }
    console.log("Recording process output:");
    console.log(`${replayNodeBinaryPath} ${jestPath} ${testPath}`);
    process.stdout.write(output);
    return;
  }

  const recordings = listAllRecordings(recordingOptions);
  const recording = recordings.find(r => r.metadata.argv.includes(jestPath));
  if (!recording) {
    logFailure(`Could not find jest recording`);
    return;
  }

  logMessage("", `Uploading and processing recording...`);
  processingPromises.push((async () => {
    const recordingId = await uploadRecording(recording.id, recordingOptions);
    if (!recordingId) {
      logFailure(`Upload failed`);
    }
    if (!await processRecording(recording.id, recordingOptions)) {
      logFailure(`Processing failed`);
    }
    logMessage("recording", `https://app.replay.io/recording/${recordingId}`);
  })());
}

function findJestPath() {
  try {
    return require.resolve("jest/bin/jest");
  } catch (e) {}
  return findExecutablePath("jest");
}

function loadConfiguration() {
  let configurationStr = process.env.RECORD_REPLAY_JEST_CONFIGURATION;
  if (!configurationStr) {
    const configurationFile = process.env.RECORD_REPLAY_JEST_CONFIGURATION_FILE;
    if (configurationFile) {
      try {
        configurationStr = fs.readFileSync(configurationFile, "utf8");
      } catch (e) {
        console.log(`Error: Exception reading record/replay configuration file: ${e}`);
      }
    }
  }
  if (configurationStr) {
    try {
      return JSON.parse(configurationStr);
    } catch (e) {
      console.log(`Error: Exception parsing record/replay configuration: ${e}`);
    }
  }
  return {};
}
