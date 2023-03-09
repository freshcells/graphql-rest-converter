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
  Location,
  OperationDefinitionNode,
  valueFromAST,
  valueFromASTUntyped,
  visit,
} from 'graphql'
import { printLocation } from 'graphql/language/printLocation'

export const hasDirective = (node: ASTNode, directiveName: string | string[]) =>
  (('directives' in node && node.directives) || []).some((directive) =>
    (typeof directiveName === 'string' ? [directiveName] : directiveName).includes(
      directive.name.value
    )
  )

export const getDirective = (node: ASTNode, directiveName: string) =>
  (('directives' in node && node.directives) || []).find(
    (directive) => directiveName === directive.name.value
  )

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

export const inlineFragmentsDocument = (document: DocumentNode): DocumentNode => {
  const fragmentMap = createFragmentMap(document.definitions)
  const newDocument: any = inlineFragments(document, fragmentMap)

  newDocument.definitions = newDocument.definitions.filter(
    (node: DefinitionNode) => !isFragmentDefinitionNode(node)
  )

  return newDocument
}

export const createFragmentMap = (input: readonly DefinitionNode[]) =>
  _.keyBy(input.filter(isFragmentDefinitionNode), (node) => node.name.value)

export const getReferencedFragments = <T extends ASTNode>(ast: T): Set<string> => {
  const referencedFragments = new Set<string>()
  visit(ast, {
    FragmentSpread: {
      enter(node) {
        referencedFragments.add(node.name.value)
      },
    },
  })
  return referencedFragments
}

export const getFragmentDependencies = (fragmentMap: Record<string, FragmentDefinitionNode>) =>
  _.mapValues(fragmentMap, getReferencedFragments)

export const getDependencyClosure = (
  roots: Set<string>,
  dependencies: Record<string, Set<string>>
) => {
  const seen = new Set()
  const stack = [...roots]
  while (stack.length) {
    const node = stack.pop()!
    if (seen.has(node)) {
      continue
    }
    seen.add(node)
    const dependencySet = dependencies[node]
    if (dependencySet) {
      stack.push(...dependencySet)
    }
  }
  return seen
}

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

export const formatMessageWithLocation = (message: string, loc?: Location) => {
  return `${message} Location: ${(loc && printLocation(loc)) || 'unknown'}`
}
