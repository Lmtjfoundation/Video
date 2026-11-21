// Vueio scene rendering on first-party Azure only: Container Apps serverless A100 GPUs (scale to zero), ACR Premium
// with artifact streaming, Azure Files (Premium, SMB multichannel) for model weights, Storage Queues + KEDA for the
// parallel scene fan-out, Event Grid for "all clips are in", a CPU FFmpeg stitcher, and Cost Management budgets.
// Deploy with deploy.sh (it builds the images between the two passes: deployJobs=false, then true).

@description('Region. East US offers Consumption-GPU-NC24-A100 and is where Vueio runs.')
param location string = resourceGroup().location
@description('Short lowercase prefix for resource names.')
@maxLength(10)
param prefix string = 'vueio'
@description('Image tag built by deploy.sh.')
param imageTag string = '1'
@description('False on the first pass (registry and storage only), true once the images are in the registry.')
param deployJobs bool = true
@description('Principal ID of the Vueio app server\'s managed identity (it uploads plans and keyframes and queues scenes).')
param appPrincipalId string = ''
@description('Parallel GPU renders (maxExecutions). Each one is a full A100 while it runs.')
@minValue(1)
@maxValue(10)
param maxParallelScenes int = 3
@description('Monthly budget for this resource group, in the subscription currency.')
param monthlyBudget int = 150
@description('Who gets the budget alerts.')
param alertEmails array
param budgetStart string = utcNow('yyyy-MM-01')

var suffix = uniqueString(resourceGroup().id)
var stName = toLower('${prefix}sc${take(suffix, 10)}')
var filesName = toLower('${prefix}md${take(suffix, 10)}')
var acrName = toLower('${prefix}acr${take(suffix, 10)}')

// ── Identity ──────────────────────────────────────────────────────────────────────────────────────────────────
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-scene-render'
  location: location
}

// ── Registry: Premium (required for artifact streaming; enabled per repository by deploy.sh) ────────────────
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: { name: 'Premium' }
  properties: { adminUserEnabled: false }
}

// ── Storage for plans, keyframes, clips and finals; queues for the fan-out. Keyless (Entra ID only). ─────────
resource st 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: stName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowSharedKeyAccess: false
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}
resource blobSvc 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: st
  name: 'default'
}
resource scenesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobSvc
  name: 'scenes'
}
// Renders are temporary: everything under scenes/ is deleted after 7 days (the finished video lives in Vueio's media).
resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: st
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'expire-renders'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['scenes/'] }
            actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 7 } } }
          }
        }
      ]
    }
  }
}
resource queueSvc 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: st
  name: 'default'
}
resource sceneQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueSvc
  name: 'scene-jobs'
}
resource stitchQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueSvc
  name: 'stitch-jobs'
}

// ── Model weights: Premium Files (FileStorage) with SMB multichannel, mounted at /models ─────────────────────
resource files 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: filesName
  location: location
  sku: { name: 'Premium_LRS' }
  kind: 'FileStorage'
  properties: { minimumTlsVersion: 'TLS1_2', supportsHttpsTrafficOnly: true, allowBlobPublicAccess: false }
}
resource fileSvc 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: files
  name: 'default'
  properties: {
    protocolSettings: { smb: { multichannel: { enabled: true } } }
  }
}
resource modelsShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileSvc
  name: 'models'
  properties: { shareQuota: 100, enabledProtocols: 'SMB' } // 100 GiB is the Premium minimum; the weights are ~25 GB
}

// ── Roles ─────────────────────────────────────────────────────────────────────────────────────────────────────
var roles = {
  blobContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  queueContributor: '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  queueSender: 'c6a89b2d-59bc-44d0-9896-0f6e12d7b80a'
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
}
resource workerBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: st
  name: guid(st.id, uami.id, roles.blobContributor)
  properties: { principalId: uami.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.blobContributor) }
}
resource workerQueue 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: st
  name: guid(st.id, uami.id, roles.queueContributor)
  properties: { principalId: uami.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.queueContributor) }
}
resource workerPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, uami.id, roles.acrPull)
  properties: { principalId: uami.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull) }
}
resource appBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(appPrincipalId)) {
  scope: st
  name: guid(st.id, appPrincipalId, roles.blobContributor)
  properties: { principalId: appPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.blobContributor) }
}
resource appQueue 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(appPrincipalId)) {
  scope: st
  name: guid(st.id, appPrincipalId, roles.queueSender)
  properties: { principalId: appPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.queueSender) }
}

// ── Event Grid: a clip landing in scenes/<id>/clips/ queues the stitch worker ────────────────────────────────
resource egTopic 'Microsoft.EventGrid/systemTopics@2022-06-15' = {
  name: '${prefix}-scenes-events'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: { source: st.id, topicType: 'Microsoft.Storage.StorageAccounts' }
}
resource egSend 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: st
  name: guid(st.id, egTopic.id, roles.queueSender)
  properties: { principalId: egTopic.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.queueSender) }
}
resource egSub 'Microsoft.EventGrid/systemTopics/eventSubscriptions@2022-06-15' = {
  parent: egTopic
  name: 'clip-created'
  dependsOn: [egSend, stitchQueue]
  properties: {
    eventDeliverySchema: 'EventGridSchema'
    deliveryWithResourceIdentity: {
      identity: { type: 'SystemAssigned' }
      destination: {
        endpointType: 'StorageQueue'
        properties: { resourceId: st.id, queueName: 'stitch-jobs', queueMessageTimeToLiveInSeconds: 86400 }
      }
    }
    filter: {
      includedEventTypes: ['Microsoft.Storage.BlobCreated']
      subjectBeginsWith: '/blobServices/default/containers/scenes/blobs/'
      subjectEndsWith: '.mp4'
      advancedFilters: [{ operatorType: 'StringContains', key: 'subject', values: ['/clips/'] }]
    }
    retryPolicy: { maxDeliveryAttempts: 10, eventTimeToLiveInMinutes: 60 }
  }
}

// ── Container Apps environment: Consumption (CPU) + serverless A100 profile; models share mounted ────────────
resource env 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: '${prefix}-scene-env'
  location: location
  properties: {
    appLogsConfiguration: { destination: 'azure-monitor' } // no Log Analytics workspace (no per-GB ingestion bill); send logs via diagnostic settings if wanted
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
      { name: 'gpu-a100', workloadProfileType: 'Consumption-GPU-NC24-A100' }
    ]
  }
}
resource envModels 'Microsoft.App/managedEnvironments/storages@2025-01-01' = {
  parent: env
  name: 'models'
  properties: {
    azureFile: { accountName: files.name, accountKey: files.listKeys().keys[0].value, shareName: modelsShare.name, accessMode: 'ReadWrite' }
  }
}

var common = [
  { name: 'AZURE_CLIENT_ID', value: uami.properties.clientId }
  { name: 'SCENES_ACCOUNT', value: st.name }
  { name: 'SCENES_CONTAINER', value: 'scenes' }
]
var registries = [{ server: acr.properties.loginServer, identity: uami.id }]
var modelsVolume = [{ name: 'models', storageType: 'AzureFile', storageName: envModels.name }]

// Scene worker: one execution per queued scene, up to maxParallelScenes at once, zero when the queue is empty.
resource sceneJob 'Microsoft.App/jobs@2025-01-01' = if (deployJobs) {
  name: '${prefix}-scene-worker'
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${uami.id}': {} } }
  dependsOn: [workerPull, workerBlob, workerQueue]
  properties: {
    environmentId: env.id
    workloadProfileName: 'gpu-a100'
    configuration: {
      triggerType: 'Event'
      replicaTimeout: 1800
      replicaRetryLimit: 1
      registries: registries
      eventTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
        scale: {
          minExecutions: 0
          maxExecutions: maxParallelScenes
          pollingInterval: 5
          rules: [
            {
              name: 'scene-queue'
              type: 'azure-queue'
              metadata: { accountName: st.name, queueName: 'scene-jobs', queueLength: '1' }
              identity: uami.id
            }
          ]
        }
      }
    }
    template: {
      containers: [
        {
          name: 'scene'
          image: '${acr.properties.loginServer}/vueio-scene-worker:${imageTag}'
          resources: { cpu: json('24'), memory: '220Gi' }
          env: concat(common, [{ name: 'SCENE_QUEUE', value: 'scene-jobs' }])
          volumeMounts: [{ volumeName: 'models', mountPath: '/models' }]
        }
      ]
      volumes: modelsVolume
    }
  }
}

// Stitcher: CPU, one execution per clip event; only the one that sees every clip does the work.
resource stitchJob 'Microsoft.App/jobs@2025-01-01' = if (deployJobs) {
  name: '${prefix}-stitch-worker'
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${uami.id}': {} } }
  dependsOn: [workerPull, workerBlob, workerQueue]
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Event'
      replicaTimeout: 900
      replicaRetryLimit: 1
      registries: registries
      eventTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
        scale: {
          minExecutions: 0
          maxExecutions: 4
          pollingInterval: 5
          rules: [
            {
              name: 'stitch-queue'
              type: 'azure-queue'
              metadata: { accountName: st.name, queueName: 'stitch-jobs', queueLength: '1' }
              identity: uami.id
            }
          ]
        }
      }
    }
    template: {
      containers: [
        {
          name: 'stitch'
          image: '${acr.properties.loginServer}/vueio-stitch-worker:${imageTag}'
          resources: { cpu: json('4'), memory: '8Gi' }
          env: concat(common, [{ name: 'STITCH_QUEUE', value: 'stitch-jobs' }])
        }
      ]
    }
  }
}

// One-time model download into the share (CPU, run by hand: az containerapp job start).
resource seedJob 'Microsoft.App/jobs@2025-01-01' = if (deployJobs) {
  name: '${prefix}-seed-models'
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${uami.id}': {} } }
  dependsOn: [workerPull]
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 7200
      replicaRetryLimit: 2
      registries: registries
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
    }
    template: {
      containers: [
        {
          name: 'seed'
          image: '${acr.properties.loginServer}/vueio-scene-worker:${imageTag}'
          command: ['python3', '/app/seed_models.py']
          resources: { cpu: json('2'), memory: '4Gi' }
          volumeMounts: [{ volumeName: 'models', mountPath: '/models' }]
        }
      ]
      volumes: modelsVolume
    }
  }
}

// ── Cost Management: a monthly budget on this resource group, alerting at 50%, 80% and 100% (and forecast) ──
resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: '${prefix}-scene-render-monthly'
  properties: {
    category: 'Cost'
    amount: monthlyBudget
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStart }
    notifications: {
      actual50: { enabled: true, operator: 'GreaterThan', threshold: 50, thresholdType: 'Actual', contactEmails: alertEmails }
      actual80: { enabled: true, operator: 'GreaterThan', threshold: 80, thresholdType: 'Actual', contactEmails: alertEmails }
      actual100: { enabled: true, operator: 'GreaterThan', threshold: 100, thresholdType: 'Actual', contactEmails: alertEmails }
      forecast100: { enabled: true, operator: 'GreaterThan', threshold: 100, thresholdType: 'Forecasted', contactEmails: alertEmails }
    }
  }
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output scenesAccount string = st.name
output filesAccount string = files.name
output environment string = env.name
