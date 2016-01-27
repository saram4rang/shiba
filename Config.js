
module.exports =
{
  ENV:            process.env.NODE_ENV || 'development',
  VERSION:        require('./package.json').version,
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
  USER_WHITELIST: [
    'bitcoininformation',
    'dexon',
    'dexonbot',
    'kungfuant',
    'rapetor',
    'ryan',
    'shiba',
    'steve'
  ]
};
