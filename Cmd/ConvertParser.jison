/* Parser for the convert command. The goal is to be flexible and
   allow every syntax imaginable and yet not resort to unmaintanable
   sets of regexps. At the moment the grammar is not LALR(1) and I
   can't be bothered to transform it, so you need to tell jison to
   create a LR(1) parser via "jison -p lr".
*/
%lex
/* flex means longest-match semantics */
%options flex case-insensitive

SIGN  [-+]
EXP   e[-+]?[0-9]+
/* We follow the US locale and use the point as a decimal
   mark and comma as the digit group seperator. However,
   we don't restrict to groups of thousands but allow the
   comma everywhere so you can also group into myriads.
*/
INT   ([1-9][0-9,]+|[0-9])
FRAC  {INT}?"."[0-9]+
NUM   {SIGN}?({FRAC}|{INT}){EXP}?

/* The modifiers we alloware micro, milli, kilo and mega.
   Both majuscule and minuscule 'k' stand for kilo.
*/
MOD   [µmk]

/* Subset of active ISO 4217 codes for which OXR gives us exchange rates. */
ISO   "AED"|"AFN"|"ALL"|"AMD"|"ANG"|"AOA"|"ARS"|"AUD"|"AWG"|"AZN"|"BAM"|"BBD"|
      "BDT"|"BGN"|"BHD"|"BIF"|"BMD"|"BND"|"BOB"|"BRL"|"BSD"|"BTC"|"BTN"|"BWP"|
      "BYR"|"BZD"|"CAD"|"CDF"|"CHF"|"CLF"|"CLP"|"CNY"|"COP"|"CRC"|"CUP"|"CVE"|
      "CZK"|"DJF"|"DKK"|"DOP"|"DZD"|"EEK"|"EGP"|"ERN"|"ETB"|"EUR"|"FJD"|"FKP"|
      "GBP"|"GEL"|"GGP"|"GHS"|"GIP"|"GMD"|"GNF"|"GTQ"|"GYD"|"HKD"|"HNL"|"HRK"|
      "HTG"|"HUF"|"IDR"|"ILS"|"IMP"|"INR"|"IQD"|"IRR"|"ISK"|"JEP"|"JMD"|"JOD"|
      "JPY"|"KES"|"KGS"|"KHR"|"KMF"|"KPW"|"KRW"|"KWD"|"KYD"|"KZT"|"LAK"|"LBP"|
      "LKR"|"LRD"|"LSL"|"LTL"|"LVL"|"LYD"|"MAD"|"MDL"|"MGA"|"MKD"|"MMK"|"MNT"|
      "MOP"|"MRO"|"MTL"|"MUR"|"MVR"|"MWK"|"MXN"|"MYR"|"MZN"|"NAD"|"NGN"|"NIO"|
      "NOK"|"NPR"|"NZD"|"OMR"|"PAB"|"PEN"|"PGK"|"PHP"|"PKR"|"PLN"|"PYG"|"QAR"|
      "RON"|"RSD"|"RUB"|"RWF"|"SAR"|"SBD"|"SCR"|"SDG"|"SEK"|"SGD"|"SHP"|"SLL"|
      "SOS"|"SRD"|"STD"|"SVC"|"SYP"|"SZL"|"THB"|"TJS"|"TMT"|"TND"|"TOP"|"TRY"|
      "TTD"|"TWD"|"TZS"|"UAH"|"UGX"|"USD"|"UYU"|"UZS"|"VEF"|"VND"|"VUV"|"WST"|
      "XAF"|"XAG"|"XAU"|"XCD"|"XDR"|"XOF"|"XPF"|"YER"|"ZAR"|"ZMK"|"ZMW"|"ZWL"|
      /* Precious metals*/
      "GOLD"|"SILVER"|
      /* Additional cryptocurrency codes. */
      "XBT"|"BITCOINS"|"BITCOIN"|
      "BITS"|"BIT"|
      "SATOSHI"|"SATOSHIS|""SAT"|
      "CLAMS"|"CLAM"|"CLAMCOINS"|"CLAMCOIN"|
      "JDCOINS"|"JDCOIN"|"JD-COINS"|"JD-COIN"|"JUSTDICECOINS"|"JUSTDICECOIN"|
      "CORNEREDCOINS"|"CORNEREDCOIN"|
      "XDG"|"DOGE"|"DOGECOINS"|"DOGECOIN"|
      "子犬"|"KOINU"|
      "LTC"|"LITECOINS"|"LITECOIN"|
      "RDD"|"REDDCOINS"|"REDDCOIN"|
      "NXT"|"NXTCOIN"

/* Currency signs. Currently doesn't include "¥" because it could stand for
 * either CNY or JPY. The Kwon symbol "₩" stands for both KRW and KPW, but we
 * consider it as KRW here, since we do not expect any  KPW users on site.
 */
PRE   "£"|"Rp"|"₹"|"₩" /* Prefix signs. */
SUF   "zł"|"₫"         /* Suffix signs. */
POS   "$"|"€"          /* Used in either way, d'oh! */

%%

\s+          /* skip whitespace */

/* We group NUM and MOD in the lexer instead of doing it in the parser
   so that they are only grouped together if they are not seperated by
   a space, e.g. we accept "100k" but not "100 k".
*/
{NUM}{MOD}   return 'NUMMOD';
{NUM}        return 'NUM';

/* Group MOD and ISO without allowing spaces, e.g.  accept "mBTC" and
   "kUSD" but not "k USD".
*/
{MOD}{ISO}   return 'MODISO';
{ISO}        return 'ISO';

/* Match currency symbols. We don't allow sub-unit modifications on
 * these (yet). */
{PRE}        return 'PRE';
{SUF}        return 'SUF';
{POS}        return 'POS';

/* Optional to. */
TO           return 'TO';

<<EOF>>      return 'EOF';
.            return 'INVALID';

/lex

%{
function normIso(sym) {
  switch(sym.toUpperCase()) {
  case 'GOLD':     return 'XAU';
  case 'SILVER':   return 'XAG';
  case 'BITS':     return 'BIT';
  case 'SATOSHI':  return 'SAT';
  case 'BITCOIN':
  case 'BITCOINS':
  case 'XBT':      return 'BTC';
  case 'CLAMS':
  case 'CLAMCOINS':
  case 'CLAMCOIN':
  case 'CORNEREDCOIN':
  case 'CORNEREDCOINS':
  case 'JUSTDICECOIN':
  case 'JD-COIN':
  case 'JDCOIN':   return 'CLAM';
  case 'DOGECOIN':
  case 'DOGECOINS':
  case 'XDG':      return 'DOGE';
  case 'LITECOINS':
  case 'LITECOIN': return 'LTC';
  case 'REDDCOINS':
  case 'REDDCOIN': return 'RDD';
  case 'NXTCOIN':  return 'NXT';
  case '子犬':     return 'KOINU';
  default:         return sym.toUpperCase();
  }
}

function sym2iso(sym) {
  switch(sym.toLowerCase()) {
  case '€':   return 'EUR';
  case '£':   return 'GBP';
  case 'rp':  return 'IDR';
  case '₹':   return 'INR';
  case 'zł':  return 'PLN';
  case '$':   return 'USD';
  case '₫':   return 'VND';
  case '₩':   return 'KRW';
  }
}

function defaultTarget(sym) {
  switch(sym.toUpperCase()) {
  case 'BIT':
  case 'BITS':
  case 'BTC':
    return 'USD';
  default:
    return 'BIT';
  }
}
%}

%start line
%%

nummod : NUMMOD
  { var m = yytext.match(/([^µmk]*)([µmk])/i);
    $$ = { num : m[1].replace(/,/g, ''),
           /* We preserve the original text for printing. */
           str : m[1],
           /* We interpret a minuscule 'm' as million and capitalize
            * it. */
           mod : m[2] === 'm' ? 'M' : m[2]
         };
  };
num : NUM
  { $$ = { num : Number(yytext.replace(/,/g, '')),
           /* We preserve the original text for printing. */
           str: yytext,
           mod: ''
         }
  };
modiso : MODISO
  { var m = yytext.match(/([µmk])([a-z]*)/i);
    $$ = { mod : m[1],
           iso : normIso(m[2])
         };
  };
iso  : ISO { $$ = normIso(yytext) };
pre  : PRE { $$ = sym2iso(yytext) };
suf  : SUF { $$ = sym2iso(yytext) };
pos  : POS { $$ = sym2iso(yytext) };
pre2 : pre { $$ = $1 } | pos { $$ = $1 };
suf2 : suf { $$ = $1 } | pos { $$ = $1 };

/* Parser for the source. This is the amount, currency and optionally
   a modifier. */
source
  : num iso     -> { amount: $1.num, str: $1.str, iso: $2,     mod: $1.mod }
  | nummod iso  -> { amount: $1.num, str: $1.str, iso: $2,     mod: $1.mod }
  | num modiso  -> { amount: $1.num, str: $1.str, iso: $2.iso, mod: $2.mod }
  | iso num     -> { amount: $2.num, str: $2.str, iso: $1,     mod: $2.mod }
  | iso nummod  -> { amount: $2.num, str: $2.str, iso: $1,     mod: $2.mod }
  | modiso num  -> { amount: $2.num, str: $2.str, iso: $1.iso, mod: $1.mod }
  | pre2 num    -> { amount: $2.num, str: $2.str, iso: $1,     mod: $2.mod }
  | pre2 nummod -> { amount: $2.num, str: $2.str, iso: $1,     mod: $2.mod }
  | num suf2    -> { amount: $1.num, str: $1.str, iso: $2,     mod: $1.mod }
  | nummod suf2 -> { amount: $1.num, str: $1.str, iso: $2,     mod: $1.mod }
  ;
/* Target for the conversion w/o modifiers. */
target
  : iso    -> $1
  | pre    -> $1
  | suf    -> $1
  | pos    -> $1
  ;
/* Target for the conversion w/ an optional modifier. */
modtarget
  : target -> { iso: $1,     mod: '' }
  | modiso -> { iso: $1.iso, mod: $1.mod }
  ;
command
  : num                     -> { amount: $1.num,    str: $1.str, fromiso: 'BIT',  frommod: '',     toiso: defaultTarget('BIT'), tomod: '' }
  | nummod                  -> { amount: $1.num,    str: $1.str, fromiso: 'BIT',  frommod: $1.mod, toiso: defaultTarget('BIT'), tomod: '' }
  | source                  -> { amount: $1.amount, str: $1.str, fromiso: $1.iso, frommod: $1.mod, toiso: defaultTarget($1.iso), tomod: '' }
  | source modtarget        -> { amount: $1.amount, str: $1.str, fromiso: $1.iso, frommod: $1.mod, toiso: $2.iso, tomod: $2.mod }
  | source TO modtarget     -> { amount: $1.amount, str: $1.str, fromiso: $1.iso, frommod: $1.mod, toiso: $3.iso, tomod: $3.mod }
  | target modtarget nummod -> { amount: $3.num,    str: $3.str, fromiso: $1,     frommod: $3.mod, toiso: $2.iso, tomod: $2.mod }
  | target modtarget num    -> { amount: $3.str,    str: $3.str, fromiso: $1,     frommod: $3.mod, toiso: $2.iso, tomod: $2.mod }
  | modiso modtarget num    -> { amount: $3.str,    str: $3.str, fromiso: $1.iso, frommod: $1.mod, toiso: $2.iso, tomod: $2.mod }
  ;
line
  : command EOF -> $1; return $1;
  ;
