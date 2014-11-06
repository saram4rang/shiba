
var fs     = require("fs");

exports = module.exports = function(env){

  env    = env || process.env.NODE_ENV || "development";

  var config = JSON.parse(fs.readFileSync("config.json", "utf8"));
  if (!config.hasOwnProperty(env))
    console.error("No configuration for env '" + env + "'");
  return config[env];
};
