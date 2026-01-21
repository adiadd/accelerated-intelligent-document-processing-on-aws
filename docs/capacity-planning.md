# Capacity Planning

Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: MIT-0

## Overview

The GenAI IDP accelerator includes comprehensive capacity planning capabilities to help you optimize document processing performance, predict resource requirements, and ensure your system can handle expected workloads. This system provides real-time capacity analysis, AWS service quota recommendations, and performance optimization guidance.

## Key Benefits

- **Predictive Analysis**: Calculate processing capacity requirements before scaling production workloads
- **Cost Optimization**: Right-size AWS resources based on actual processing patterns
- **Performance Planning**: Identify bottlenecks and optimize processing pipelines
- **Quota Management**: Automatically calculate required AWS service quotas
- **Load Distribution**: Plan processing schedules to maximize throughput
- **Real-time Monitoring**: Track capacity utilization and adjust dynamically

## Architecture Overview

The capacity planning system consists of several integrated components that work together to provide comprehensive capacity analysis:

![Capacity Planning Architecture](../images/capacity-planning-flow.png)

### Core Components

1. **Capacity Calculation Engine**: Lambda-based processing engine that analyzes document requirements
2. **Concurrency Management**: DynamoDB-based system for tracking and controlling parallel executions
3. **Web UI Interface**: Interactive capacity planning calculator and visualization dashboard
4. **Monitoring Integration**: Real-time metrics collection and performance tracking
5. **Quota Analysis**: Automated AWS service quota requirement calculation

### Data Flow

1. **Input Configuration**: Users define document types, volumes, and processing requirements
2. **Historical Analysis**: System analyzes past processing data for baseline metrics
3. **Capacity Calculation**: Engine processes requirements and generates capacity recommendations
4. **Quota Assessment**: System calculates required AWS service quotas
5. **Visualization**: Results displayed through interactive dashboard with actionable insights

## Capacity Planning Features

### 1. Interactive Capacity Calculator

The Web UI provides an intuitive interface for capacity planning:

**Document Configuration**:
- Document type selection and custom type definition
- Token usage estimation per processing stage
- Page count and complexity factor configuration
- Processing pattern selection (Pattern 1, 2, or 3)

**Load Distribution Planning**:
- Hourly processing schedule configuration
- Peak load time identification
- Document volume distribution across time slots
- Maximum latency requirement settings

**Real-time Calculations**:
- Processing time percentile analysis (P50, P75, P90, P95, P99)
- Throughput capacity requirements
- Resource utilization projections
- Cost estimation based on processing volumes

### 2. Advanced Analytics Engine

The capacity calculation engine provides sophisticated analysis capabilities:

**Processing Time Analysis**:
```json
{
  "pattern-1": {"summarization": 45.0},
  "pattern-2": {
    "ocr": 8.0,
    "classification": 3.5, 
    "extraction": 12.0,
    "assessment": 5.0,
    "summarization": 8.0
  },
  "pattern-3": {
    "ocr": 8.0,
    "classification": 2.0,
    "extraction": 12.0, 
    "assessment": 5.0,
    "summarization": 8.0
  }
}
```

**Latency Distribution Modeling**:
- Statistical analysis of processing times
- Percentile-based performance predictions
- Variance factor calculations for load planning
- Complexity-based processing time adjustments

**Load Factor Analysis**:
- System load vs. capacity calculations
- Bottleneck identification and resolution recommendations
- Adaptive scaling suggestions based on processing patterns
- Performance optimization guidance

### 3. Concurrency Management System

**Dynamic Concurrency Control**:
- Real-time tracking of active workflow executions
- Configurable maximum concurrent workflow limits
- Automatic backpressure management during peak loads
- Queue depth monitoring and optimization

**ConcurrencyTable (DynamoDB)**:
- Atomic increment/decrement operations for workflow tracking
- Initialized with `workflow_counter` starting at 0
- Provides thread-safe concurrency management
- Supports high-throughput document processing

**Queue Management**:
- SQS-based document processing queue
- Intelligent message batching for optimal throughput
- Visibility timeout management (30 seconds default)
- Dead letter queue handling for failed processing

### 4. AWS Service Quota Analysis

**Automated Quota Calculation**:
- Bedrock model invocation limits
- Lambda concurrent execution requirements
- Step Functions execution quotas
- DynamoDB read/write capacity units
- S3 request rate limits

**Quota Recommendations**:
- Service-specific quota increase suggestions
- Buffer percentage calculations (default 20%)
- Regional quota availability analysis
- Cost impact assessment for quota increases

## Configuration and Customization

### Stack-Level Parameters

**Core Capacity Settings**:
- `MaxConcurrentWorkflows`: Maximum parallel executions (default: 100)
- `DataRetentionInDays`: Data retention period (default: 365)
- `ErrorThreshold`: Error alerting threshold (default: 1)
- `ExecutionTimeThresholdMs`: Processing timeout (default: 300000ms)

**Processing Configuration**:
- `LogLevel`: Logging verbosity (DEBUG, INFO, WARN, ERROR)
- `LogRetentionDays`: CloudWatch log retention (default: 30)
- `EnableXRayTracing`: Distributed tracing enablement
- `EnableMCP`: Model Context Protocol integration

### Environment Variables

**Calculation Parameters**:
- `PROCESSING_VARIANCE_FACTOR`: Processing time variance (default: 1.5)
- `BASE_LOAD_FACTOR`: Base system load multiplier (default: 1.2)
- `BEDROCK_LOAD_THRESHOLD`: Bedrock utilization threshold (default: 0.7)
- `LATENCY_SAFETY_FACTOR`: Latency calculation safety margin (default: 0.9)

**Recommendation Thresholds**:
- `RECOMMENDATION_HIGH_COMPLEXITY_THRESHOLD`: High complexity threshold (default: 2.5)
- `RECOMMENDATION_MEDIUM_COMPLEXITY_THRESHOLD`: Medium complexity threshold (default: 1.5)
- `RECOMMENDATION_HIGH_LOAD_THRESHOLD`: High load threshold (default: 3.0)
- `RECOMMENDATION_MEDIUM_LOAD_THRESHOLD`: Medium load threshold (default: 2.0)

### Pattern-Specific Configuration

**Pattern 1 (BDA)**:
- Bedrock Data Automation processing
- Packet and media document support
- Summarization-focused capacity planning
- Limited to high-level throughput analysis

**Pattern 2 (Textract + Bedrock)**:
- Full capacity planning support
- OCR, classification, and extraction analysis
- Comprehensive latency distribution modeling
- Token usage optimization recommendations

**Pattern 3 (Textract + UDOP + Bedrock)**:
- UDOP classification integration
- SageMaker endpoint capacity planning
- Multi-stage processing optimization
- Advanced document type classification

## Using the Capacity Planning System

### 1. Accessing the Capacity Planner

Navigate to the Web UI and select the "Capacity Planning" section:

1. **Login**: Use your Cognito credentials to access the Web UI
2. **Navigate**: Click on "Capacity Planning" in the main navigation
3. **Configure**: Set up your document processing requirements
4. **Calculate**: Run capacity analysis and review recommendations

### 2. Document Configuration

**Step 1: Document Type Setup**
```javascript
// Example document configuration
{
  "documentType": "invoice",
  "averagePages": 3,
  "complexityFactor": 1.2,
  "expectedTokens": {
    "ocr": 1500,
    "classification": 200,
    "extraction": 800
  }
}
```

**Step 2: Processing Schedule**
- Define hourly processing volumes
- Set peak processing times
- Configure maximum acceptable latency
- Specify processing pattern requirements

**Step 3: Analysis Parameters**
- Select latency percentile requirements (P90, P95, P99)
- Configure load distribution preferences
- Set cost optimization priorities
- Define scaling preferences

### 3. Interpreting Results

**Processing Metrics**:
- **Throughput**: Documents processed per hour
- **Latency**: Processing time percentiles
- **Utilization**: Resource usage percentages
- **Bottlenecks**: Identified performance constraints

**Quota Requirements**:
- **Bedrock**: Model invocation limits needed
- **Lambda**: Concurrent execution requirements
- **Step Functions**: Workflow execution quotas
- **Storage**: S3 and DynamoDB capacity needs

**Recommendations**:
- **Scaling**: Resource scaling suggestions
- **Optimization**: Performance improvement opportunities
- **Cost**: Cost optimization recommendations
- **Architecture**: Architectural enhancement suggestions

### 4. Implementation Planning

**Phase 1: Baseline Establishment**
1. Run capacity analysis with current document volumes
2. Identify existing bottlenecks and constraints
3. Establish performance baselines and metrics
4. Document current AWS service quota utilization

**Phase 2: Scaling Preparation**
1. Request necessary AWS service quota increases
2. Configure monitoring and alerting thresholds
3. Implement recommended architectural optimizations
4. Test scaling scenarios with synthetic workloads

**Phase 3: Production Scaling**
1. Gradually increase document processing volumes
2. Monitor performance metrics and capacity utilization
3. Adjust configurations based on real-world performance
4. Implement automated scaling policies as needed

## Monitoring and Optimization

### Real-time Capacity Monitoring

**CloudWatch Integration**:
- Concurrent workflow execution tracking
- Queue depth and processing rate monitoring
- Service-specific latency and throughput metrics
- Error rate and retry pattern analysis

**Dashboard Metrics**:
- **Capacity Utilization**: Current vs. maximum capacity usage
- **Processing Latency**: Real-time latency percentiles
- **Queue Health**: Message processing rates and backlogs
- **Resource Usage**: AWS service utilization percentages

### Performance Optimization

**Bottleneck Identification**:
- Processing stage analysis for performance constraints
- Resource utilization pattern identification
- Queue depth and processing rate correlation
- Service-specific performance optimization opportunities

**Optimization Strategies**:
- **Parallel Processing**: Increase concurrent workflow limits
- **Batch Optimization**: Adjust message batching parameters
- **Resource Scaling**: Scale Lambda memory and timeout settings
- **Model Selection**: Optimize Bedrock model choices for performance vs. cost

### Cost Optimization

**Cost Analysis Features**:
- Processing cost per document calculation
- Service-specific cost breakdown and optimization
- Volume-based pricing tier recommendations
- Reserved capacity vs. on-demand cost analysis

**Cost Optimization Recommendations**:
- **Right-sizing**: Optimize Lambda memory and timeout configurations
- **Model Selection**: Balance model performance with cost considerations
- **Scheduling**: Distribute processing to optimize cost efficiency
- **Retention**: Optimize data retention policies for cost management

## Advanced Features

### 1. Predictive Scaling

**Machine Learning Integration**:
- Historical processing pattern analysis
- Seasonal workload prediction
- Automated scaling recommendation generation
- Proactive capacity planning based on trends

**Adaptive Recommendations**:
- Dynamic threshold adjustment based on performance data
- Context-aware optimization suggestions
- Workload-specific configuration recommendations
- Performance trend-based capacity planning

### 2. Multi-Pattern Optimization

**Cross-Pattern Analysis**:
- Comparative performance analysis across processing patterns
- Pattern selection recommendations based on document characteristics
- Resource sharing optimization between patterns
- Unified capacity planning across multiple patterns

**Pattern-Specific Optimizations**:
- **Pattern 1**: BDA-specific capacity planning and optimization
- **Pattern 2**: OCR and extraction pipeline optimization
- **Pattern 3**: UDOP classification and multi-stage processing optimization

### 3. Integration Capabilities

**API Integration**:
- GraphQL API for programmatic capacity planning
- REST endpoints for external system integration
- Webhook support for real-time capacity notifications
- CLI integration for automated capacity management

**External System Integration**:
- CI/CD pipeline integration for automated capacity testing
- Monitoring system integration for alerting and notifications
- Cost management system integration for budget tracking
- Workflow orchestration system integration for automated scaling

## Troubleshooting and Best Practices

### Common Issues and Solutions

**High Latency Issues**:
- **Symptom**: Processing times exceed expected latency percentiles
- **Diagnosis**: Check concurrent workflow limits and queue depth
- **Solution**: Increase `MaxConcurrentWorkflows` or optimize processing stages

**Capacity Underutilization**:
- **Symptom**: Low resource utilization despite high processing volumes
- **Diagnosis**: Analyze bottlenecks in processing pipeline
- **Solution**: Optimize batch sizes and parallel processing configuration

**Quota Limit Errors**:
- **Symptom**: AWS service quota exceeded errors
- **Diagnosis**: Review quota usage and increase requirements
- **Solution**: Request quota increases based on capacity planning recommendations

### Best Practices

**Capacity Planning**:
- Run capacity analysis regularly to account for changing workloads
- Use historical data to establish accurate baseline metrics
- Plan for peak processing periods with appropriate buffer capacity
- Monitor and adjust configurations based on real-world performance

**Performance Optimization**:
- Implement gradual scaling to identify optimal configurations
- Use A/B testing for configuration changes and optimizations
- Monitor cost implications of performance optimization changes
- Document configuration changes and their performance impact

**Monitoring and Alerting**:
- Set up proactive alerting for capacity threshold breaches
- Monitor trends in processing latency and throughput
- Track cost metrics alongside performance metrics
- Implement automated responses to common capacity issues

## Integration with Other Features

### Evaluation Framework Integration

The capacity planning system integrates with the evaluation framework to provide:
- **Accuracy vs. Performance Trade-offs**: Balance processing speed with extraction accuracy
- **Baseline Performance Metrics**: Use evaluation results to establish capacity baselines
- **Quality-Adjusted Capacity Planning**: Factor accuracy requirements into capacity calculations

### Cost Calculator Integration

Capacity planning works with the cost calculator to provide:
- **Volume-Based Cost Projections**: Calculate costs based on planned processing volumes
- **Optimization Cost Analysis**: Assess cost impact of performance optimizations
- **ROI Analysis**: Evaluate return on investment for capacity increases

### Monitoring System Integration

The capacity planning system leverages monitoring capabilities for:
- **Real-time Capacity Tracking**: Monitor actual vs. planned capacity utilization
- **Performance Trend Analysis**: Use historical data for future capacity planning
- **Automated Alerting**: Trigger alerts when capacity thresholds are exceeded

This comprehensive capacity planning system ensures your GenAI IDP deployment can handle current and future document processing requirements while optimizing for performance, cost, and reliability.