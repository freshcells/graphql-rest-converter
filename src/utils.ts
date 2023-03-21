import {
  BridgeOperations,
  CreateOpenAPISchemaConfig,
  CustomOperationProps,
  SchemaComponents,
} from './types.js'
import _ from 'lodash'
import { createOpenAPISchemaFromOperations } from './openApi.js'
import OpenAPISchemaValidatorImport from 'openapi-schema-validator'
import { VariableDefinitionNode, VariableNode } from 'graphql'
import { getDirective, getDirectiveArgumentsUntyped } from './graphqlUtils.js'
import { OpenAPIDirectives } from './graphql.js'

const OpenAPISchemaValidator = OpenAPISchemaValidatorImport.default || OpenAPISchemaValidatorImport

export const getParameterName = (node: VariableNode, nodeDef: VariableDefinitionNode) => {
  const paramDirectiveValue = getDirective(nodeDef, OpenAPIDirectives.Param)
  if (!paramDirectiveValue) {
    return node.name.value
  }
  const directiveParams = getDirectiveArgumentsUntyped(paramDirectiveValue)

  return (directiveParams['name'] as string) || node.name.value
}

export const resolveSchemaComponents = (schema: any, schemaComponents: SchemaComponents) => {
  if (typeof schema !== 'object' || schema === null) {
    return
  }
  if ('$ref' in schema) {
    const refTarget = schema.$ref as string
    delete schema.$ref
    for (const [k, v] of Object.entries(
      schemaComponents[refTarget.replace('#/components/schemas/', '')]
    )) {
      schema[k] = _.cloneDeep(v)
    }
  }
  for (const value of Object.values(schema)) {
    resolveSchemaComponents(value, schemaComponents)
  }
}

export const createOpenAPISchemaWithValidate = <
  T extends CustomOperationProps = CustomOperationProps
>(
  operations: BridgeOperations<T>,
  config?: CreateOpenAPISchemaConfig<T>
) => {
  const openAPISchema = createOpenAPISchemaFromOperations<T>(
    config?.baseSchema || {},
    operations,
    config?.transform
  )
  if (config?.validate) {
    const schemaValidator = new OpenAPISchemaValidator({ version: 3 })
    const schemaValidationErrors = schemaValidator.validate(openAPISchema)
    if (schemaValidationErrors?.errors?.length) {
      throw new Error(JSON.stringify(schemaValidationErrors))
    }
  }
  return openAPISchema
}
