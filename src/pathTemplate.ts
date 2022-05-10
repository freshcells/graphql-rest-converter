// Seems to be somewhat based on RFC6570
// Relies on the fact that variable is a full segment
export const getVariablesFromPathTemplate = (pathTemplate: string) => {
  const variables: Set<string> = new Set()
  for (const pathSegment of pathTemplate.split('/')) {
    if (pathSegment[0] === '{' && pathSegment[pathSegment.length - 1] === '}') {
      variables.add(pathSegment.slice(1, pathSegment.length - 1))
    }
  }
  return variables
}

export const pathTemplateToExpressRoute = (pathTemplate: string) => {
  let expressRoute = pathTemplate
  const variables = getVariablesFromPathTemplate(pathTemplate)
  for (const variable of variables) {
    expressRoute = expressRoute.replace(`{${variable}}`, `:${variable}`)
  }
  return expressRoute
}
