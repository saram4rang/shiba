/* Parser for the crash command. The goal is to be flexible and
   allow every syntax imaginable and yet not resort to unmaintanable
   sets of regexps. At the moment the grammar is not LALR(1) and I
   can't be bothered to transform it, so you need to tell jison to
   create a LR(1) parser via "jison -p lr".
*/
%lex
%options flex case-insensitive

CP     [1-9][0-9,]*(\.[0-9]?[0-9]?)?
INST   "0"(\."0"?"0"?)?

CRASH  ({CP}|{INST})"x"?
CRASHk ({CP}|{INST})"k""x"?
CRASHm ({CP}|{INST})"m""x"?

%%

\s+          /* skip whitespace */

{CRASH}      return 'CRASH';
{CRASHk}     return 'CRASHk';
{CRASHm}     return 'CRASHm';
"<"          return 'LT';
"<="         return 'LTE';
">"          return 'GT';
">="         return 'GTE';
"=="|"="     return 'EQ';

"x"          return 'X';


<<EOF>>      return 'EOF';
.            return 'INVALID';

/lex

%start line
%%

crash
  : CRASH  -> Math.round(1e2 * parseFloat(yytext.replace(/[,x]/g, '')))
  | CRASHk -> Math.round(1e5 * parseFloat(yytext.replace(/[,xk]/g, '')))
  | CRASHm -> Math.round(1e8 * parseFloat(yytext.replace(/[,xm]/g, '')))
  ;

command
  : crash                  ->  { min: $1, max: $1 }
  | EQ crash               ->  { min: $2, max: $2 }
  | LT crash               ->  { max: $2 - 1 }
  | LTE crash              ->  { max: $2     }
  | GT crash               ->  { min: $2 + 1 }
  | GTE crash              ->  { min: $2     }
  | X LT crash             ->  { max: $3 - 1 }
  | X LTE crash            ->  { max: $3     }
  | X GT crash             ->  { min: $3 + 1 }
  | X GTE crash            ->  { min: $3     }
  | crash LT               ->  { min: $1 + 1 }
  | crash LTE              ->  { min: $1     }
  | crash GT               ->  { max: $1 - 1 }
  | crash GTE              ->  { max: $1     }
  | crash LT X             ->  { min: $1 + 1 }
  | crash LTE X            ->  { min: $1     }
  | crash GT X             ->  { max: $1 - 1 }
  | crash GTE X            ->  { max: $1     }
  | crash LT X LT crash    ->  { min: $1 + 1, max: $5 - 1 }
  | crash LT X LTE crash   ->  { min: $1 + 1, max: $5     }
  | crash LTE X LT crash   ->  { min: $1,     max: $5 - 1 }
  | crash LTE X LTE crash  ->  { min: $1,     max: $5     }
  | crash GT X GT crash    ->  { min: $5 + 1, max: $1 - 1 }
  | crash GT X GTE crash   ->  { min: $5,     max: $1 - 1 }
  | crash GTE X GT crash   ->  { min: $5 + 1, max: $1     }
  | crash GTE X GTE crash  ->  { min: $5,     max: $1     }
  ;
line
  : command EOF -> $1; return $1;
  ;
