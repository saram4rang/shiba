
let packageJson = require('./package.json');

/* eslint no-process-env: 0 */
module.exports =
{
  ENV:            process.env.NODE_ENV || 'development',
  VERSION:        packageJson.version,
  CLIENT_SEED:
    process.env.BUSTABIT_CLIENTSEED ||
    '0000000003a96dc6e52672a487ec577fc32e71a8f99bdbbf7329bf27f9772544',
  GAMESERVER:     process.env.BUSTABIT_GAMESERVER || 'https://gs.zcrash.io',
  WEBSERVER:      process.env.BUSTABIT_WEBSERVER || 'https://www.zcrash.io',
  OXR_APP_ID:     process.env.OXR_APP_ID,
  SESSION:        process.env.SHIBA_SESSION,
  DATABASE:       process.env.SHIBA_DATABASE || 'postgres://localhost/shibadb',
  CHAT_HISTORY:   process.env.SHIBA_CHAT_HISTORY || 2000,
  GAME_HISTORY:   process.env.SHIBA_GAME_HISTORY || 200,
  /* keep in lowercase */
  USER_WHITELIST: [
    'kungfuant',
    'ryan',
    'shiba',
    'nekoz'
  ]
};
