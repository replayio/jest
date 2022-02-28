const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { removeColors, waitForProcessExit, findExecutablePath } = require("./utils");
const { listAllRecordings, uploadRecording, processRecording } = require("@recordreplay/recordings-cli");

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

  const failures = getTestFailures(output);

  const recordingDirectories = [];
  const processingPromises = [];
  for (const failure of failures) {
    const dir = makeRecordingsDirectory();
    recordingDirectories.push(dir);
    await replayTest(failure, dir, processingPromises);
  }
  await Promise.all(processingPromises);

  recordingDirectories.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));

  process.exit(code || (signal ? 1 : 0));
}

function getTestFailures(output) {
  const lines = removeColors(output).split("\n");
  const failures = new Set();
  for (const line of lines) {
    const match = /^\s*FAIL\s+(.*)/.exec(line);
    if (match) {
      failures.add(match[1]);
    }
  }
  return [...failures];
}

function makeRecordingsDirectory() {
  const dir = path.join(os.tmpdir(), `recordreplay-cypress-${(Math.random() * 1e9) | 0}`);
  fs.mkdirSync(dir);
  return dir;
}

async function replayTest(testPath, recordingsDir, processingPromises) {
  function logMessage(prefix, msg) {
    console.log(`replay-jest ${testPath}${prefix ? " " + prefix : ""}: ${msg}`);
  }

  logMessage("", `Creating recording...`);

  function logFailure(why) {
    logMessage("failed", why);
  }

  const replayNodePath = findExecutablePath("replay-node");
  if (!replayNodePath) {
    logFailure(`replay-node not installed, try "npm i replay-node -g"`);
    return;
  }

  const jestPath = findExecutablePath("jest");
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
    replayNodePath,
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

  const failures = getTestFailures(output);
  if (!failures.length) {
    logFailure(`Recording process did not have test failures`);
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
