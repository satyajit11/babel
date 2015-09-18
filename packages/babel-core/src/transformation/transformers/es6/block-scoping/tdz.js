import * as t from "babel-types";

function getTDZStatus(refPath, bindingPath) {
  var executionStatus = bindingPath._guessExecutionStatusRelativeTo(refPath);

  if (executionStatus === "before") {
    return "inside";
  } else if (executionStatus === "after") {
    return "outside"
  } else {
    return "maybe";
  }
}

function buildTDZAssert(node, file) {
  return t.callExpression(
    file.addHelper("temporal-assert-defined"),
    [node, t.stringLiteral(node.name), file.addHelper("temporal-undefined")]
  );
}

function isReference(node, scope, state) {
  var declared = state.letReferences[node.name];
  if (!declared) return false;

  // declared node is different in this scope
  return scope.getBindingIdentifier(node.name) === declared;
}

export var visitor = {
  ReferencedIdentifier(node, parent, scope, state) {
    if (t.isFor(parent, { left: node })) return;
    if (!isReference(node, scope, state)) return;

    var bindingPath = scope.getBinding(node.name).path;

    var status = getTDZStatus(this, bindingPath);
    if (status === "inside") return;

    if (status === "maybe") {
      var assert = buildTDZAssert(node, state.file);

      // add tdzThis to parent variable declarator so it's exploded
      bindingPath.parent._tdzThis = true;

      this.skip();

      if (t.isUpdateExpression(parent)) {
        if (parent._ignoreBlockScopingTDZ) return;
        this.parentPath.replaceWith(t.sequenceExpression([assert, parent]));
      } else {
        return t.logicalExpression("&&", assert, node);
      }
    } else if (status === "outside") {
      return t.throwStatement(t.inherits(
        t.newExpression(t.identifier("ReferenceError"), [
          t.stringLiteral(`${node.name} is not defined - temporal dead zone`)
        ]),
        node
      ));
    }
  },

  AssignmentExpression: {
    exit(node, parent, scope, state) {
      if (node._ignoreBlockScopingTDZ) return;

      var nodes = [];
      var ids = this.getBindingIdentifiers();

      for (var name in ids) {
        var id = ids[name];

        if (isReference(id, scope, state)) {
          nodes.push(buildTDZAssert(id, state.file));
        }
      }

      if (nodes.length) {
        node._ignoreBlockScopingTDZ = true;
        nodes.push(node);
        return nodes.map(t.expressionStatement);
      }
    }
  }
};