const aws = require('aws-sdk')
const clientSecretsManager = new aws.SecretsManager()

// https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets-lambda-function-overview.html
const steps = {
  createSecret: createSecret,
  setSecret: setSecret,
  testSecret: testSecret,
  finishSecret: finishSecret
}

exports.handler = async (event) => {
  console.log(event)

  const step = event.Step
  const token = event.ClientRequestToken
  const arn = event.SecretId

  const stepHandler = steps[step]
  if (stepHandler) {
    await stepHandler(clientSecretsManager, arn, token)
  }
  return null
}

/*
    In this step, the Lambda function generates a new version of the secret.

    Depending on your scenario, this can be as simple as just generating a new password.
    Or you can generate values for a completely new set of credentials, including a user name and password that are appropriate for the secured resource.

    These values are then stored as a new version of the secret in Secrets Manager.
    Other values in the secret that don't need to change, such as the connection details,
    are cloned from the existing version of the secret. The new version of the secret is then given the staging label AWSPENDING to mark it as the "in-process" version of the secret.
*/
async function createSecret (clientSecretsManager, arn, token) {
  const { RandomPassword: randomPassword } = await clientSecretsManager.getRandomPassword({
    PasswordLength: 32,
    ExcludePunctuation: true
  }).promise()
  console.log('RETRIEVED RANDOM PASSWORD:', randomPassword)

  const newSecretValue = {
    authMasterKey: randomPassword
  }
  const putSecretValueResponse = await clientSecretsManager.putSecretValue({
    SecretId: arn,
    SecretString: JSON.stringify(newSecretValue),
    VersionStages: ['AWSPENDING'],
    ClientRequestToken: token
  }).promise()
  console.log('PUT PENDING SECRET:', putSecretValueResponse)
}

/*
    In this step, the rotation function retrieves the version of the secret labeled AWSPENDING from Secrets Manager
    (the version you just created in the previous step).
    It then invokes the database's or service's identity service to change the existing password,
    or to create new credentials that match the new ones in the secret.

    If a new user is created, then the function must clone the permissions from the previous user.
    This is so that the new user can continue to perform as needed within your custom app.

    To change a password or to create new credentials in the database's or service's authentication system, you must give the Lambda function permission to carry out such tasks.

    These are considered "administrative" tasks that require permissions that you typically don't want your users do to have.

    So we recommend that you use a second set of credentials that have permissions to change the password or create new users for the 'main' secret, as dictated by your rotation strategy. We refer to these credentials as the master secret, and they're stored as a separate secret from the main secret. The ARN of this master secret is stored in the main secret for use by the rotation function.
    The master secret never needs to be accessed by your end user custom application.
    It's instead accessed only by the Lambda rotation function of the main secret, to update or create new credentials in the database when rotation occurs.
*/
async function setSecret (clientSecretsManager, arn) {
  return null
}

/*
    This step of the Lambda function verifies that the AWSPENDING version of the secret is good by trying to use it to access the secured resource in the same way that your custom application would.

    If the application needs read-only access to the database, then the function should verify that the test reads succeed.

    If the app needs to be able to write to the database, then the function should perform some test writes to verify that level of access.
*/
async function testSecret (clientSecretsManager, arn) {
  const pendingSecret = await clientSecretsManager.getSecretValue({
    SecretId: arn,
    VersionStage: 'AWSPENDING'
  }).promise()
  console.log('RETRIEVED PENDING SECRET')
  const pendingSecretValue = JSON.parse(pendingSecret.SecretString)

  // Test pending secret values against remote database, api or whatever
}

/*
    This step performs any resource-specific finalization on this version of the secret.

    When it's done, the last step is for the Lambda function to move the label AWSCURRENT from it's current version to this new version of the secret so that your clients start using it.

    You can also remove the AWSPENDING label, but it's not technically required.

    At this point, the basic rotation is done. The new version of the secret is the one used by all of your clients.

    The old version gets the AWSPREVIOUS staging label, and is available for recovery as the "last known good" version of the secret, if needed.
    The old version that had the AWSPREVIOUS staging label no longer has any staging labels attached, so it's considered deprecated and subject to deletion by Secrets Manager.
*/
async function finishSecret (clientSecretsManager, arn, token) {
  const currentSecret = await clientSecretsManager.getSecretValue({
    SecretId: arn,
    VersionStage: 'AWSCURRENT'
  }).promise()
  console.log('RETRIEVED CURRENT SECRET:', currentSecret)
  const versionId = currentSecret.VersionId

  const updateSecretVersionState = await clientSecretsManager.updateSecretVersionStage({
    SecretId: arn,
    VersionStage: 'AWSCURRENT',
    MoveToVersionId: token,
    RemoveFromVersionId: versionId
  }).promise()
  console.log('PROMOTED PENDING SECRET TO CURRENT:', updateSecretVersionState)
}
