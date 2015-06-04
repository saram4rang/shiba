/* Parser for the crash command. The goal is to be flexible and
   allow every syntax imaginable and yet not resort to unmaintanable
   sets of regexps. At the moment the grammar is not LALR(1) and I
   can't be bothered to transform it, so you need to tell jison to
   create a LR(1) parser via "jison -p lr".
*/
%lex
%options flex case-insensitive

INT    [1-9][0-9]*
CP     [1-9][0-9,]*(\.[0-9]?[0-9]?)?
INST   "0"(\."0"?"0"?)?

CRASH  ({CP}|{INST})"x"?
CRASHk ({CP}|{INST})"k""x"?
CRASHm ({CP}|{INST})"m""x"?

%%

\s+          /* skip whitespace */

{INT}        return 'INT';
{CRASH}      return 'CRASH';
{CRASHk}     return 'CRASHk';
{CRASHm}     return 'CRASHm';
"<="|"<"|">="|">"|"=="|"=" return 'OP';

"x"          return 'X';


<<EOF>>      return 'EOF';
.            return 'INVALID';

/lex

%start line
%%

crash
  : INT    -> 1e2 * parseInt(yytext)
  | CRASH  -> Math.round(1e2 * parseFloat(yytext.replace(/[,x]/g, '')))
  | CRASHk -> Math.round(1e5 * parseFloat(yytext.replace(/[,xk]/g, '')))
  | CRASHm -> Math.round(1e8 * parseFloat(yytext.replace(/[,xm]/g, '')))
  ;

op
  : OP     -> yytext
  ;

int
  : INT    -> parseInt(yytext)
  ;

command
  : op crash               ->  { op: $1, bound: $2 }
  | int op crash           ->  { op: $2, bound: $3, count: $1 }
  ;
line
  : command EOF -> $1; return $1;
  ;
