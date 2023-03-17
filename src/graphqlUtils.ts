import _ from 'lodash'
import {
  ASTNode,
  DefinitionNode,
  DirectiveNode,
  DocumentNode,
  FragmentDefinitionNode,
  FragmentSpreadNode,
  GraphQLDirective,
  GraphQLObjectType,
  Kind,
  OperationDefinitionNode,
  valueFromAST,
  valueFromASTUntyped,
  visit,
} from 'graphql'
import { GraphQLSchema, VariableDefinitionNode } from 'graphql/index'

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

export const removeDescriptionFromObjectType = <T, S>(node: GraphQLObjectType<T, S>) => {
  return new GraphQLObjectType({ ...node.toConfig(), description: null })
}

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

export const getDirectiveArgumentsWithSchema = (
  schema: GraphQLSchema,
  node: VariableDefinitionNode,
  directive: string
) => {
  const thisDirective = schema.getDirective(directive)
  const directiveValue = getDirective(node, directive)
  return directiveValue && thisDirective
    ? getDirectiveArguments(thisDirective, directiveValue)
    : null
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
