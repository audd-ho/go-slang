import { nodeType } from "./ast/nodeTypes";
import * as nodes from "./ast/nodes";
import * as Token from "./tokens/tokens";
import * as Instruction from "./instructions"

let instrs : Instruction.Instruction[];
let lidx : number;
let compileEnv : CompileEnvironment;
let constantInst : Map<string, Instruction.Instruction>;

export function compile(file : nodes.File) : Instruction.Instruction[] {
    instrs = [];
    lidx = 0;
    compileEnv = new CompileEnvironment();
    constantInst = new Map();
    constant_keywords.forEach(keyword => constantInst.set(keyword, 
        new Instruction.IdentInstruction(keyword, compileEnv.compile_time_environment_position(keyword))));
    compileNode(file, compileEnv);
    instrs[lidx++] = new Instruction.DoneInstruction;
    return instrs;
}

function compileNode(node : nodes.GoNode, env : CompileEnvironment, doNotExtendEnv?: boolean) {
    const type : nodeType = node.getType();
    switch (type) {
        case nodeType.BASIC_LIT:
            compileLiteral(node as nodes.BasicLit, env);
            break;
        case nodeType.IDENT:
            compileIdent(node as nodes.Ident, env);
            break;
        case nodeType.UNARY:
            compileUnaryOp(node as nodes.UnaryExpr, env);
            break;
        case nodeType.BINARY:
            compileBinaryOp(node as nodes.BinaryExpr, env);
            break;
        case nodeType.IF:
            compileIf(node as nodes.IfStmt, env);
            break;
        case nodeType.FOR:
            compileFor(node as nodes.ForStmt, env);
            break;
        case nodeType.CALL:
            compileCall(node as nodes.CallExpr, env);
            break;
        case nodeType.ASSIGN:
            compileAssign(node as nodes.AssignStmt, env);
            break;
        case nodeType.FUNCD:
            compileFunc(node as nodes.FuncDecl, env);
            break;
        case nodeType.FUNCLIT:
            compileFunc(node as nodes.FuncLit, env);
            break;
        case nodeType.BLOCK:
            compileBlock(node as nodes.BlockStmt, env, doNotExtendEnv);
            break;
        case nodeType.PAREN:
            compileParen(node as nodes.ParenExpr, env);
            break;
        case nodeType.EMPTY:
            // nothing to compile
            break;
        case nodeType.FILE:
            compileFile(node as nodes.File, env);
            break;
        case nodeType.DECL:
            compileDeclStmt(node as nodes.DeclStmt, env);
            break;
        case nodeType.GENDECL:
            compileGenDecl(node as nodes.GenDecl, env);
            break;
        case nodeType.VALUESPEC:
            compileValueSpec(node as nodes.ValueSpec, env);
            break;
        case nodeType.RETURN:
            compileReturnStmt(node as nodes.ReturnStmt, env);
            break;
        case nodeType.EXPRSTMT:
            compileExprStmt(node as nodes.ExprStmt, env);
            break;
        case nodeType.GOSTMT:
            compileGoStmt(node as nodes.GoStmt, env);
            break;
        case nodeType.SEND:
            compileSendStmt(node as nodes.SendStmt, env);
            break;
        case nodeType.BREAK:
            compileBreakStmt();
            break;
        case nodeType.CONT:
            compileContinueStmt();
            break;
        case nodeType.ILLEGAL:
            throw new IllegalInstructionError();
        default:
            throw new UnsupportedInstructionError();
    }
}

function compileLiteral(node : nodes.BasicLit, _ : CompileEnvironment) {
    const tag = node.getDataType();
    switch (tag) {
        case Token.token.INT | Token.token.FLOAT:
            instrs[lidx++] = new Instruction.BasicLitInstruction(tag, Number(node.Value));
            break;
        case Token.token.CHAR | Token.token.STRING:
            instrs[lidx++] = new Instruction.BasicLitInstruction(tag, node.Value);
            break;
        case Token.token.IMAG:
            throw new Error("complex numbers unsupported");
    }
}

function compileIdent(node : nodes.Ident, env : CompileEnvironment) {
    instrs[lidx++] = new Instruction.IdentInstruction(node.Name, 
        env.compile_time_environment_position(node.Name));
}

function compileUnaryOp(node : nodes.UnaryExpr, env : CompileEnvironment) {
    compileNode(node.X, env);
    instrs[lidx++] = new Instruction.UnOpInstruction(node.Op);
}

function compileBinaryOp(node : nodes.BinaryExpr, env : CompileEnvironment) {
    const op = node.Op;
    const jofInst = new Instruction.JumpOnFalseInstruction();
    const gotoInst = new Instruction.GotoInstruction();
    switch (op) {
        case Token.token.AND:
            compileNode(node.X, env);
            instrs[lidx++] = jofInst;
            compileNode(node.Y, env);
            instrs[lidx++] = gotoInst;
            jofInst.setJumpDest(lidx);
            instrs[lidx++] = constantInst.get("false") as Instruction.Instruction;
            gotoInst.setGotoDest(lidx);
            break;
        case Token.token.OR:
            compileNode(node.X, env);
            instrs[lidx++] = jofInst;
            instrs[lidx++] = constantInst.get("true") as Instruction.Instruction;
            instrs[lidx++] = gotoInst;
            jofInst.setJumpDest(lidx);
            compileNode(node.Y, env);
            gotoInst.setGotoDest(lidx);
            break;
        default:
            compileNode(node.X, env);
            compileNode(node.Y, env);
            instrs[lidx++] = new Instruction.BinOpInstruction(node.Op);
    }
}

function compileIf(node : nodes.IfStmt, env : CompileEnvironment) {
    let initIdents : EnvironmentSymbol[] = []
    if (node.Init !== undefined) {
        initIdents = scanOutDecls(node.Init);
        if (initIdents.length !== 0) {
            // initialisation statement may declare new variables, these should
            // exist only within the implicit scope of the If block
            instrs[lidx++] = new Instruction.EnterScopeInstruction(initIdents.length);
        }
        compileNode(node.Init, env);
    }
    compileNode(node.Cond, env);
    const jofInst = new Instruction.JumpOnFalseInstruction();
    instrs[lidx++] = jofInst;
    compileNode(node.Body, env);
    // if the consequent is executed, jump over the goto statement
    jofInst.setJumpDest(lidx + 1);
    if (node.Else !== undefined) {
        const gotoInst = new Instruction.GotoInstruction();
        instrs[lidx++] = gotoInst;
        compileNode(node.Else, env);
        gotoInst.setGotoDest(lidx);
    }
    // if a scope was created by the initialisation statement, exit this scope
    if (initIdents.length !== 0) {
        instrs[lidx++] = new Instruction.ExitScopeInstruction();
    }
}

function compileFor(node : nodes.ForStmt, env : CompileEnvironment) {
    let initDecls : EnvironmentSymbol[] = [];
    if (node.Init !== undefined) {
        initDecls = scanOutDecls(node.Init);
        compileNode(node.Init, env);
        if (initDecls.length !== 0) {
            // create new scope if initialisation statement has declarations
            instrs[lidx++] = new Instruction.EnterScopeInstruction(initDecls.length);
        }
    }
    const loop_start = lidx;
    let jofInst : Instruction.JumpOnFalseInstruction | undefined = undefined;
    if (node.Cond !== undefined) {
        compileNode(node.Cond, env);
        jofInst = new Instruction.JumpOnFalseInstruction();
    }
    compileNode(node.Body, env);
    instrs[lidx++] = new Instruction.IterEndInstruction();
    if (node.Post !== undefined) {
        compileNode(node.Post, env);
    }
    const nextIterInst = new Instruction.GotoInstruction();
    nextIterInst.setGotoDest(loop_start);
    instrs[lidx++] = nextIterInst;
    instrs[lidx++] = new Instruction.ForEndInstruction();
    if (jofInst !== undefined) {
        jofInst.setJumpDest(lidx);
    }
    if (initDecls.length !== 0) {
        // exit scope created by init at the end of the for loop
        instrs[lidx++] = new Instruction.ExitScopeInstruction();
    }
}

// Future TODO: Function calls support the spread operator - consider integration
function compileCall(node : nodes.CallExpr, env : CompileEnvironment) {
    compileNode(node.Func, env);
    let arity = 0;
    if (node.Args !== undefined) {
        for (var arg of node.Args) {
            compileNode(arg, env);
            ++arity;
        }
    }
    instrs[lidx++] = new Instruction.CallInstruction(arity);
}

const IGNORE_IDENT = "_"

function compileAssign(node : nodes.AssignStmt, env : CompileEnvironment) {
    // TODO: Use type checker to ensure correct number of arguments on each side + type matches
    // type checker will also ensure that we do not assign to constants

    let lhs_pos : EnvironmentPos[] = [];
    for (var lhs of node.LeftHandSide) {
        // TODO: extend support for index expressions and pointer indirections for LHS operands
        // for now, assume that they are variables
        if (lhs.getType() === nodeType.IDENT) {
            const lhsIdent = lhs as nodes.Ident;
            if (lhsIdent.Name !== IGNORE_IDENT) {
                // assigning to constants should be flagged out by the type-checker
                const pos = env.compile_time_environment_position(lhsIdent.Name);
                lhs_pos.push(pos);
            } else {
                // identifier is "_", do not assign
                lhs_pos.push(IgnoreEnvironmentPos);
            }
        } else {
            // Future work should consider index expressions and pointer indirections, but for now
            // we will treat them as the blank identifier
            lhs_pos.push(IgnoreEnvironmentPos);
        }
    }

    // evaluate RHS from left-to-right
    for (var rhs of node.RightHandSide) {
        compileNode(rhs, env);
    }
    for (let i = node.LeftHandSide.length - 1; i >= 0; --i) {
        if (lhs_pos[i] === IgnoreEnvironmentPos) {
            instrs[lidx++] = new Instruction.PopInstruction();
            continue;
        }
        // values are in a stack, hence we have to assign from right-to-left
        instrs[lidx++] = new Instruction.AssignInstruction(lhs_pos[i]);
    }
}

function compileFunc(node : nodes.FuncDecl | nodes.FuncLit, env : CompileEnvironment) {
    // TODO: Implement Receiver methods
    instrs[lidx++] = new Instruction.LoadFunctionInstruction(node.Type.numParams(), lidx + 1);
    // jump over function body
    const gotoInst = new Instruction.GotoInstruction();
    instrs[lidx++] = gotoInst;
    // function parameters cannot be constant in Go
    let params : EnvironmentSymbol[] = [];
    if (node.Type.Params.List !== undefined) {
        for (var param of node.Type.Params.List) {
            for (var ident of param.Names) {
                params.push(new EnvironmentSymbol(ident.Name));
            }
        }
    }
    const bodyDecl = scanOutDecls(node.Body);
    const idents = env.combineFrames(params !== undefined ? params : [], bodyDecl);
    // function body is a block, use the current scope (containing function parameters + scanned out declarations)
    compileNode(node.Body, env.compile_time_extend_environment(idents), true);
    instrs[lidx++] = new Instruction.ResetInstruction();
    gotoInst.setGotoDest(lidx);
}

function compileBlock(node : nodes.BlockStmt, env : CompileEnvironment, doNotExtendEnv?: boolean) {
    const scopeRequired = doNotExtendEnv === null || !doNotExtendEnv;
    let newEnv = env;
    if (scopeRequired) {
        const locals = scanOutDecls(node);
        instrs[lidx++] = new Instruction.EnterScopeInstruction(locals.length);
        newEnv = env.compile_time_extend_environment(locals);
    }
    for (var stmt of node.List) {
        const stmtType = stmt.getType();
        if (stmtType === nodeType.CONST || stmtType === nodeType.VAR || stmtType === nodeType.TYPE) {
            // declarations have already been scanned out
            continue;
        }
        compileNode(stmt, newEnv);
    }
    if (scopeRequired) {
        instrs[lidx++] = new Instruction.ExitScopeInstruction();
    }
}

function compileParen(node : nodes.ParenExpr, env : CompileEnvironment) {
    compileNode(node.Expr, env);
}

function compileFile(node : nodes.File, env : CompileEnvironment) {
    const decls = scanOutDecls(node);
    instrs[lidx++] = new Instruction.EnterScopeInstruction(decls.length);
    const newEnv = env.compile_time_extend_environment(decls);
    for (let decl of node.Decls) {
        compileNode(decl, newEnv);
    }
    instrs[lidx++] = new Instruction.ExitScopeInstruction();
}

function compileGenDecl(node : nodes.GenDecl, env : CompileEnvironment) {
    const type = node.getType();
    if (type === nodeType.VAR || type === nodeType.CONST) {
        const specs = node.Specs as nodes.ValueSpec[]
        specs.forEach(spec => compileNode(spec, env));
    }
    // Future TODO : Implement ability to compile type declarations
}

function compileValueSpec(node : nodes.ValueSpec, env: CompileEnvironment) {
    if (node.Type !== undefined) {
        node.Values.forEach(val => compileNode(val, env));
        // number of values on RHS must match number of variables on LHS (enforced by type checker)
        for (var i = node.Names.length - 1; i >= 0; --i) {
            instrs[lidx++] = new Instruction.AssignInstruction(env.compile_time_environment_position(node.Names[i].Name));
        }
    } 
}

function compileExprStmt(node : nodes.ExprStmt, env : CompileEnvironment) {
    compileNode(node.Expr, env);
    const resCount = node.Expr.valuesProduced();
    for (var i = 0; i < resCount; ++i) {
        // results of expressions will not be used, pop it from the stack
        instrs[lidx++] = new Instruction.PopInstruction();
    }
}

function compileGoStmt(node : nodes.GoStmt, env : CompileEnvironment) {
    compileNode(node.Call, env);
    const callArity = (instrs[lidx - 1] as Instruction.CallInstruction).arity;
    instrs[lidx - 1] = new Instruction.GoInstruction(callArity) // replace the call instruction
    const gotoInst = new Instruction.GotoInstruction(); // calling goroutine will execute goto statement
    instrs[lidx++] = gotoInst;
    instrs[lidx++] = new Instruction.CallInstruction(callArity); // goroutine will start at this instruction
    instrs[lidx++] = new Instruction.DestroyGoroutineInstruction(); // spawned goroutine will destroy itself upon reading this instruction
    gotoInst.setGotoDest(lidx); // calling goroutine will jump past the 2 instructions above
}

function compileDeclStmt(node : nodes.DeclStmt, env : CompileEnvironment) {
    compileNode(node.Decl, env);
}

function compileSendStmt(node : nodes.SendStmt, env : CompileEnvironment) {
    compileNode(node.Chan, env);
    compileNode(node.Value, env);
    instrs[lidx++] = new Instruction.SendInstruction();
}

function compileReturnStmt(node : nodes.ReturnStmt, env : CompileEnvironment) {
    node.Results.forEach(resNode => compileNode(resNode, env));
    instrs[lidx++] = new Instruction.ResetInstruction();
}

function compileContinueStmt() {
    instrs[lidx++] = new Instruction.ContinueInstruction();
}

function compileBreakStmt() {
    instrs[lidx++] = new Instruction.BreakInstruction;
}

function scanOutDecls(node : nodes.StatementNode) : EnvironmentSymbol[] {
    const type = node.getType();
    switch (type) {
        case nodeType.BLOCK:
            return scanStatementList((node as nodes.BlockStmt).List);
        case nodeType.FILE:
            return scanStatementList((node as nodes.File).Decls);
    }
    return [];
}

function scanStatementList(stmts : nodes.StatementNode[]) : EnvironmentSymbol[] {
    let decls : EnvironmentSymbol[] = [];
    for (var stmt of stmts) {
        switch (stmt.getType()) {
            case nodeType.FUNCD:
                decls.push(new EnvironmentSymbol((stmt as nodes.FuncDecl).Name.Name));
                break;
            case nodeType.DECL:
                const genDeclSpecs = ((stmt as nodes.DeclStmt).Decl as nodes.GenDecl).Specs;
                for (var spec of genDeclSpecs) {
                    if (spec.getType() === nodeType.VALUESPEC) {
                        (spec as nodes.ValueSpec).Names.forEach(ident => decls.push(new EnvironmentSymbol(ident.Name)));
                    } else {
                        decls.push(new EnvironmentSymbol((spec as nodes.TypeSpec).Name.Name));
                    }
                }
                break;
        }
    }
    return decls;
}