import * as cdk from "@aws-cdk/core";
import * as lambda from "@aws-cdk/aws-lambda-nodejs";
import * as apigateway from "@aws-cdk/aws-apigateway";
import * as s3 from "@aws-cdk/aws-s3";
import * as s3deploy from "@aws-cdk/aws-s3-deployment";
import * as cloudfront from "@aws-cdk/aws-cloudfront";

export class LambdaCdkStack extends cdk.Stack {
	constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		// ---- backend ----

		const api = new apigateway.RestApi(this, "authApi", {
			restApiName: "Backend Frontend AWS CDK",
		});

		// this needs to match the behaviour path pattern in the cloudfront distribution
		// https://stackoverflow.com/questions/32825413/how-do-you-add-cloudfront-in-front-of-api-gateway?rq=1#comment112085934_53804396
		const apiResource = api.root.addResource("api");

		// home lambda
		const homeLambda = new lambda.NodejsFunction(this, "homeFunction", {
			entry: "src/backend/home.ts",
			handler: "handler",
		});

		const homeResource = apiResource.addResource("home");
		const homeIntegration = new apigateway.LambdaIntegration(homeLambda);
		homeResource.addMethod("GET", homeIntegration);

		// ---- frontend ----

		// bucket
		const bucketName = "frontend-aws-cdk";
		const siteBucket = new s3.Bucket(this, "SiteBucket", {
			bucketName,
			websiteIndexDocument: "index.html",
			websiteErrorDocument: "error.html",
			publicReadAccess: true,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		// cloudfront distribution
		const distribution = new cloudfront.CloudFrontWebDistribution(
			this,
			"SiteDistribution",
			{
				originConfigs: [
					{
						customOriginSource: {
							domainName: siteBucket.bucketWebsiteDomainName,
							originProtocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
						},
						behaviors: [{ isDefaultBehavior: true }],
					},
					// api origin - https://stackoverflow.com/a/57467656/728602
					{
						customOriginSource: {
							domainName: `${api.restApiId}.execute-api.${this.region}.${this.urlSuffix}`,
						},
						originPath: `/${api.deploymentStage.stageName}`,
						behaviors: [
							{
								pathPattern: "/api/*", // needs to match a path common with the gateway, see apiResource for more
								allowedMethods: cloudfront.CloudFrontAllowedMethods.ALL,
								forwardedValues: {
									queryString: true,
									headers: ["Authorization"],
								},
							},
						],
					},
				],
			}
		);
		new cdk.CfnOutput(this, "CloudfrontDistributionURL", {
			value: "https://" + distribution.distributionDomainName,
		});

		// Deploy site contents to S3 bucket
		new s3deploy.BucketDeployment(this, "DeployWithInvalidation", {
			sources: [s3deploy.Source.asset("src/frontend/build")],
			destinationBucket: siteBucket,
			distribution,
			distributionPaths: ["/*"],
		});
	}
}
