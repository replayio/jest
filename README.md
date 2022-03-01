# Replay Jest

`replay-jest` is a wrapper around [Jest](https://www.npmjs.com/package/jest) that creates recordings of failed tests for debugging using the [Replay](https://replay.io) devtools.

## Installing

Install `replay-jest` either locally within the project, or globally with `-g`.  `replay-jest` uses the [replay-node](https://www.npmjs.com/package/@recordreplay/replay-node-cli) package and is currently only available on macOS and linux.

```
npm i @recordreplay/jest
```

If `replay-jest` and `jest` are local to a package, add a script to the `package.json`:

```
  "scripts": {
    "replay-jest": "replay-jest",
  },
```

## Usage

Recording and uploading tests requires an API key, see the settings in the replay devtools to obtain one.  Set the `RECORD_REPLAY_API_KEY` environment variable to this key while running `replay-jest`.

If `replay-jest` and `jest` are installed globally, record tests by running `replay-jest`.

If `replay-jest` and `jest` are installed locally, run the script added to `package.json`: `npm run replay-jest` or `yarn replay-jest`.

`replay-jest` runs all tests normally.  Afterwards, it detects failed tests and creates recordings for each of them, uploading them to the replay web service and ensuring they have been processed so they will load quickly.  Lines like the ones below will be logged to show progress and any errors.  The recording URLs can be loaded in any web browser for debugging.

```
replay-jest $TestPath: Creating recording...
replay-jest $TestPath: Uploading and processing recording...
replay-jest $TestPath recording: https://app.replay.io/recording/$RecordingId
```

By default, recordings will only be created for failing tests, and at most 10 recordings will be created in one test run.

To override this default behavior, a configuration JSON object can be specified with additional options. This can be specified either via the value of the `RECORD_REPLAY_JEST_CONFIGURATION` environment variable, or in a file referenced by the `RECORD_REPLAY_JEST_CONFIGURATION_FILE` environment variable.

Configuration objects can have the following properties:

* `maxRecordings`: A number overriding the maximum number of recordings which can be created in one test run.

* `recordAll`: Set to record all tests, up to the maximum number of recordings allowed.

* `randomize`: Set to randomize which tests will be selected to record if there are more than the maximum number allowed. This is useful to improve coverage in CI environments when there are many tests which could be recorded.
