import {
  AgentCoreApplication,
  AgentCoreMcp,
  AgentCorePayments,
  type AgentCoreMcpSpec,
  type AgentCoreProjectSpec,
  type HarnessDeploymentConfig,
} from '@aws/agentcore-cdk';
import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/**
 * The role-scoped fields used to configure an AgentCore harness deployment.
 * The full harness specification is included when a harness must be emitted as
 * a CloudFormation resource.
 */
export type HarnessConfig = HarnessDeploymentConfig;

interface CredentialState {
  credentialProviderArn: string;
  clientSecretArn?: string;
}

export interface AgentCoreStackProps extends StackProps {
  readonly spec: AgentCoreProjectSpec;
  readonly mcpSpec?: AgentCoreMcpSpec;
  readonly credentials?: Record<string, CredentialState>;
  readonly connectorParametersByFile?: Record<string, Record<string, unknown>>;
  readonly harnesses?: HarnessConfig[];
  /**
   * Payment credentials are resolved by the AgentCore CLI before synthesis.
   * They replace the raw payment entries in the project spec only when present.
   */
  readonly paymentSpec?: AgentCoreProjectSpec['payments'];
}

/**
 * Stack wrapper used by the AgentCore CLI-generated entry point.
 *
 * Keeping the application, MCP, and payments constructs in one stack preserves
 * their resource wiring while providing a stable import for local CDK commands
 * and tests.
 */
export class AgentCoreStack extends Stack {
  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    const { paymentSpec, spec, ...stackProps } = props;
    super(scope, id, stackProps);

    const deploymentSpec: AgentCoreProjectSpec = paymentSpec ? { ...spec, payments: paymentSpec } : spec;

    const application = new AgentCoreApplication(this, 'Application', {
      spec: deploymentSpec,
      credentials: props.credentials,
      connectorParametersByFile: props.connectorParametersByFile,
      harnesses: props.harnesses,
    });

    if (props.mcpSpec) {
      new AgentCoreMcp(this, 'Mcp', {
        projectName: deploymentSpec.name,
        mcpSpec: props.mcpSpec,
        agentCoreApplication: application,
        credentials: props.credentials,
        projectTags: deploymentSpec.tags,
      });
    }

    if (deploymentSpec.payments?.length) {
      new AgentCorePayments(this, 'Payments', {
        spec: deploymentSpec,
        credentials: props.credentials,
        agentCoreApplication: application,
      });
    }

    new CfnOutput(this, 'StackNameOutput', {
      value: this.stackName,
      description: 'Name of the CloudFormation Stack',
    });
  }
}
