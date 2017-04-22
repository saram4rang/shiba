
let packageJson = require('./package.json');

/* eslint no-process-env: 0 */
module.exports =
{
  ENV:            process.env.NODE_ENV || 'development',
  VERSION:        packageJson.version,
  CLIENT_SEED:
    process.env.BUSTABIT_CLIENTSEED ||
    '000000000000000007a9a31ff7f07463d91af6b5454241d5faf282e5e0fe1b3a',
  GAMESERVER:     process.env.BUSTABIT_GAMESERVER || 'https://gs.bustabit.com',
  WEBSERVER:      process.env.BUSTABIT_WEBSERVER || 'https://www.bustabit.com',
  OXR_APP_ID:     process.env.OXR_APP_ID,
  SESSION:        process.env.SHIBA_SESSION,
  DATABASE:       process.env.SHIBA_DATABASE || 'postgres://localhost/shibadb',
  CHAT_HISTORY:   process.env.SHIBA_CHAT_HISTORY || 2000,
  GAME_HISTORY:   process.env.SHIBA_GAME_HISTORY || 200,
  /* keep in lowercase */
  USER_WHITELIST: [
    '01010100b',
    'alexk08',
    'almighty',
    'beebo',
    'bitcoininformation',
    'cooldad',
    'cowbay',
    'csm',
    'delorian',
    'dexon',
    'dexonbot',
    'dmt',
    'dooglus',
    'dxc',
    'gecox22',
    'kungfuant',
    'lakai',
    'martinbot',
    'marting',
    'neta',
    'netaban',
    'qcrc5u4',
    'rapetor',
    'ryan',
    'shiba',
    'steve',
    'techdeck',
    'turtledaddykim',
    'wake_up_son',
    'xrnath'
  ]
};
