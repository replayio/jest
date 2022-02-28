const { spawnSync } = require("child_process");

spawnSync("jest", [], { stdio: "inherit" });
