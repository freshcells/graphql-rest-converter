import _ from 'lodash'
import {
  ASTNode,
  DefinitionNode,
  DirectiveNode,
  DocumentNode,
  FragmentDefinitionNode,
  FragmentSpreadNode,
  GraphQLDirective,
  Kind,
  OperationDefinitionNode,
  valueFromAST,
  valueFromASTUntyped,
  visit,
} from 'graphql'

export const getDirectiveArguments = (
  directiveDefinition: GraphQLDirective,
  directive: DirectiveNode
) => {
  const args: Record<string, unknown> = {}
  const argsByName = _.keyBy(directive.arguments || [], (x) => x.name.value)
  for (const argDef of directiveDefinition.args || []) {
    if (!(argDef.name in argsByName)) {
      if (argDef.astNode?.defaultValue) {
        args[argDef.name] = argDef.defaultValue
      }
      continue
    }
    args[argDef.name] = valueFromAST(argsByName[argDef.name].value, argDef.type)
  }
  return args
}

export const getDirectiveArgumentsUntyped = (directive: DirectiveNode) => {
  const args: Record<string, unknown> = {}
  for (const directiveArg of directive.arguments || []) {
    // `valueFromASTUntyped` cannot provide default values
    args[directiveArg.name.value] = valueFromASTUntyped(directiveArg.value)
  }
  return args
}

export const isOperationDefinitionNode = (node: DefinitionNode): node is OperationDefinitionNode =>
  node.kind === Kind.OPERATION_DEFINITION

export const isFragmentDefinitionNode = (node: DefinitionNode): node is FragmentDefinitionNode =>
  node.kind === Kind.FRAGMENT_DEFINITION

export const inlineFragmentsDocument = (document: DocumentNode) => {
  const fragmentMap = createFragmentMap(document.definitions)
  const newDocument = inlineFragments(document, fragmentMap)

  // @ts-ignore
  newDocument.definitions = newDocument.definitions.filter(
    (node: DefinitionNode) => !isFragmentDefinitionNode(node)
  )

  return newDocument
}

export const createFragmentMap = (input: readonly DefinitionNode[]) =>
  _.keyBy(input.filter(isFragmentDefinitionNode), (node) => node.name.value)

export const inlineFragments = <T extends ASTNode>(
  ast: T,
  fragmentMap: Record<string, FragmentDefinitionNode>
): T => {
  let currentOperation: OperationDefinitionNode | null = null
  return visit(ast, {
    OperationDefinition: {
      enter(node) {
        currentOperation = node
      },
      leave() {
        currentOperation = null
      },
    },
    SelectionSet: {
      enter(node) {
        if (currentOperation) {
          return {
            ...node,
            selections: node.selections.map((selection) =>
              selection.kind === Kind.FRAGMENT_SPREAD
                ? toInlineFragment(selection, fragmentMap[selection.name.value])
                : selection
            ),
          }
        }
      },
    },
  })
}

const toInlineFragment = (
  fragmentSpread: FragmentSpreadNode,
  fragmentDefinition: FragmentDefinitionNode
) => {
  return {
    kind: Kind.INLINE_FRAGMENT,
    loc: fragmentSpread.loc,
    typeCondition: fragmentDefinition.typeCondition,
    directives: fragmentSpread.directives,
    selectionSet: fragmentDefinition.selectionSet,
  }
}
