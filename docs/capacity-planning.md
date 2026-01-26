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

### Core Components

1. **GraphQL Resolver**: `CalculateCapacityResolverFunction` that handles capacity calculation requests
2. **Capacity Calculation Engine**: Lambda-based processing engine that analyzes document requirements and generates recommendations
3. **Web UI Interface**: Interactive React-based capacity planning calculator with real-time visualizations
4. **Token Usage Analysis**: Automatic population of token usage from processed documents' metering data
5. **Quota Analysis**: Automated AWS service quota requirement calculation with direct links to AWS console
6. **Latency Distribution Modeling**: Statistical analysis of processing times with percentile-based predictions

### Data Flow

1. **Input Configuration**: Users define document types, token usage, and processing schedules through the Web UI
2. **Historical Analysis**: System extracts token usage from processed documents' metering data
3. **Capacity Calculation**: GraphQL resolver invokes calculation engine to process requirements
4. **Response Sanitization**: Results are sanitized to match GraphQL schema before returning to UI
5. **Quota Assessment**: System calculates required AWS service quotas with direct console links
6. **Visualization**: Results displayed through interactive dashboard with hourly token distribution charts

## Capacity Planning Features

### 1. Interactive Capacity Calculator

The Web UI provides an intuitive interface for capacity planning with real-time token usage population:

**Document Configuration**:
- Document type selection from configured classes or add custom types
- Average pages per document (can be manually entered or automatically populated from processed documents' metering data)
- Token usage configuration for each processing step (OCR, Classification, Extraction, Assessment, Summarization)
- Support for automatic token and page count population from processed documents' metering data
- CSV import/export functionality for bulk configuration

**Processing Schedule Configuration**:
- Hourly processing schedule with document type and volume specification
- Visual time slot selection (24-hour format)
- Document type filtering based on configured types
- CSV import/export for schedule management

**Real-time Token Analysis**:
- Hourly token distribution visualization with stacked bar charts
- Peak hour analysis with load distribution insights
- Processing time percentile analysis (P50, P75, P90, P95, P99)
- Latency distribution modeling with SLA compliance checking

### 2. Advanced Analytics Engine

The capacity calculation system provides sophisticated analysis through GraphQL resolvers:

**Token Usage Extraction**:
- Automatic extraction from processed documents' metering data
- Context-aware parsing of OCR, classification, extraction, assessment, and summarization tokens
- Request count estimation based on token chunking patterns
- Page count extraction from OCR processing data

**Latency Distribution Modeling**:
- Statistical analysis of processing times with percentile calculations
- Queue delay modeling based on processing volume and AWS service quotas
- SLA compliance checking against configured maximum latency
- Performance warning alerts for quota limit exceedances

**Response Sanitization**:
- GraphQL schema compliance validation
- Error handling with structured error responses
- Field sanitization to prevent null responses from AppSync
- Comprehensive logging for debugging and monitoring

### 3. Document Token Usage Population

**Automatic Token Population from Processed Documents**:
- Integration with Documents context to access processed document data
- Extraction of token usage from metering data structure
- Support for multiple document selection and batch population
- Document picker modal with filtering and selection capabilities

**Metering Data Processing**:
- Context-prefixed key parsing (OCR/, Classification/, Extraction/, Assessment/, Summarization/, BDAProject/bda/)
- Token count aggregation from inputTokens, outputTokens, and totalTokens fields
- Request count estimation based on token chunking patterns using `VITE_DEFAULT_MAX_TOKENS_PER_REQUEST`
- Page count extraction from OCR Bedrock requests (using `metrics.requests` as page count)
- BDA pattern support with page-based token estimation using `VITE_BDA_TOKENS_PER_PAGE`

**Token Usage Validation**:
- Required OCR token validation for Bedrock OCR configurations
- Document type matching and configuration merging
- Empty configuration filtering and cleanup
- CSV import/export with validation and error handling

### 4. AWS Service Quota Analysis

**Automated Quota Calculation**:
- Dynamic model configuration from deployment settings
- Bedrock model invocation limits calculation based on token usage
- Tokens Per Minute (TPM) quota requirements for each model
- Regional quota availability analysis with direct console links

**Quota Requirements Display**:
- Service-specific quota increase suggestions with model details
- Current vs. required quota comparison with utilization percentages
- Status indicators (✓ Sufficient, ⚠️ Increase Needed)
- Direct links to AWS Service Quotas console for quota requests

**Environment Configuration Support**:
- `VITE_BEDROCK_MODEL_QUOTA_CODES`: Optional mapping of model IDs to quota codes (not configured by default)
- `VITE_AWS_REGION`: Regional console URL generation (required)
- Fallback to generic Bedrock quotas page when `VITE_BEDROCK_MODEL_QUOTA_CODES` is missing
- Support for multiple AWS regions through `VITE_AWS_REGION` configuration

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

**UI Configuration Parameters**:
- `VITE_DEFAULT_MAX_LATENCY`: Default maximum latency setting (15 minutes)
- `VITE_LATENCY_OPTIONS`: JSON array of available latency options [5, 15, 30, 60]
- `VITE_DEFAULT_TOKENS_BY_STEP`: JSON object with default token limits per processing step (OCR:4000, Classification:2000, Extraction:8000, Assessment:4000, Summarization:4000, default:4000)
- `VITE_DEFAULT_MAX_TOKENS_PER_REQUEST`: Default maximum tokens per API request (4000)
- `VITE_BDA_TOKENS_PER_PAGE`: Estimated tokens per page for BDA pattern processing (2000)

**AWS Service Integration**:
- `VITE_AWS_REGION`: AWS region for console URL generation (e.g., us-east-1)
- `VITE_BEDROCK_MODEL_QUOTA_CODES`: Optional JSON mapping of Bedrock model IDs to quota codes (not configured by default)
- `CALCULATE_CAPACITY_FUNCTION_NAME`: Lambda function name for capacity calculations (set by CloudFormation)

**Token Usage Configuration**:
- Token chunking estimation for request count calculations based on `VITE_DEFAULT_MAX_TOKENS_PER_REQUEST`
- Model-specific token usage patterns extracted from processed documents' metering data

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

1. **Prerequisites**: Ensure you have processed some documents first to populate token usage data
2. **Configuration**: Visit "View/Edit Configuration" tab to load your pattern configuration
3. **Navigation**: Click on "Capacity Planning" in the main navigation
4. **Pattern Detection**: System automatically detects your deployment pattern (Pattern 1, 2, or 3)

### 2. Document Configuration

**Step 1: Document Type Setup**
- Select document types from configured classes or add custom types
- Use "Populate tokens from Documents" to automatically extract token usage from processed documents
- Configure average pages per document (extracted from actual processing data)
- Set token usage for each processing step (OCR, Classification, Extraction, Assessment, Summarization)

**Step 2: Token Population from Processed Documents**
```javascript
// Example of automatic token extraction from metering data
{
  "OCR/bedrock/us.amazon.nova-lite-v1:0": {
    "totalTokens": 1500,
    "requests": 3,
    "pages": 3
  },
  "Classification/bedrock/anthropic.claude-3-haiku": {
    "inputTokens": 800,
    "outputTokens": 200
  },
  "BDAProject/bda/project-id": {
    "pages": 5,
    // Tokens calculated as: pages * VITE_BDA_TOKENS_PER_PAGE (2000)
  }
}
```

**Step 3: CSV Import/Export**
- Import document configurations from CSV files
- Export current configurations for backup or sharing
- Validation for required OCR tokens when Bedrock OCR is configured

### 3. Processing Schedule Configuration

**Hourly Processing Schedule**:
- Configure processing volumes by hour using 24-hour time slots
- Select document types from configured types only
- Specify documents per hour for each time slot and document type
- Visual time slot selection with hour range display (e.g., "09:00 - 10:00")

**Schedule Management**:
- Add multiple time slots for different processing periods
- Remove time slots that are no longer needed (minimum one slot required)
- CSV import/export for bulk schedule management
- Validation to ensure only configured document types are used

**Maximum Latency Configuration**:
- Select from predefined latency options: 5, 15, 30, or 60 minutes
- Default setting is typically 15 minutes
- Used for SLA compliance checking and performance validation
- Used for SLA compliance checking and performance validation

### 4. Capacity Calculation and Results

**Running Capacity Analysis**:
- Click "Calculate Capacity Requirements" to perform analysis
- System validates configuration and processes requirements
- GraphQL resolver invokes capacity calculation Lambda function
- Results are sanitized and returned to the UI

**Capacity Metrics Display**:
- **Total Docs**: Aggregate documents per hour across all time slots
- **Total Pages**: Calculated from document volumes and average pages
- **Total Tokens**: Aggregated token usage across all processing steps (displayed in millions)

**Latency Distribution Analysis**:
- Processing time percentiles (P50, P75, P90, P95, P99)
- Base processing time vs. queue delay breakdown
- SLA compliance checking against maximum allowed latency
- Performance warnings for quota limit exceedances

**Hourly Token Distribution Visualization**:
- Stacked bar chart showing token usage by hour and processing step
- Color-coded by processing type (OCR, Classification, Extraction, Assessment, Summarization)
- Peak hour analysis with load distribution insights
- Interactive tooltips with detailed token counts

### 5. AWS Service Quota Management

**Quota Requirements Analysis**:
- Automatic calculation of required Bedrock model quotas (Tokens Per Minute)
- Current vs. required quota comparison with utilization percentages
- Status indicators: ✓ Sufficient, ⚠️ Increase Needed, or ⚠️ Check AWS Console
- Model-specific quota requirements with step context (e.g., "claude-3-haiku (Classification)")

**Direct AWS Console Integration**:
- "Request Increase" buttons that open AWS Service Quotas console
- Region-specific console URLs using configured AWS region
- Model-specific quota code mapping for direct navigation
- Fallback to generic Bedrock quotas page when configuration is missing

**Quota Request Generation**:
- "Generate AWS Support Request" button for comprehensive quota increases
- Automatic filtering of quotas that need increases
- Direct links to AWS Service Quotas console or Support Center
- Export functionality for quota requirements documentation

## Advanced Features

### 1. Token Usage Analysis and Visualization

**Hourly Token Distribution Chart**:
- Interactive stacked bar chart showing token usage by hour
- Color-coded by processing step (OCR: Purple, Classification: Orange, Extraction: Green, Assessment: Blue, Summarization: Red)
- Dynamic scaling based on peak token usage
- Hover tooltips with detailed token counts per step

**Peak Hour Analysis**:
- Automatic identification of peak processing hours
- Peak vs. average load comparison with percentage differences
- Peak inference type identification (which step uses most tokens)
- Load distribution insights across active processing hours

**Token Extraction from Metering Data**:
- Context-aware parsing of metering data structure
- Support for different metering key formats (OCR/, Classification/, Extraction/, etc.)
- Request count estimation based on token chunking patterns
- Page count extraction from OCR Bedrock requests

### 2. Pattern-Specific Configuration

**Pattern Detection and Override**:
- Automatic pattern detection from deployment settings (`IDPPattern`)
- Manual pattern override capability for testing different configurations
- Pattern-specific token usage and processing step configuration
- Visual pattern indicator with deployment information display

**Pattern 1 (BDA) Support**:
- Simplified token analysis focused on summarization processing only
- BDA-specific token estimation using `VITE_BDA_TOKENS_PER_PAGE` (2000 tokens per page)
- Page-based token calculation for packet and media documents from `BDAProject/bda/` metering keys
- Limited quota analysis due to BDA processing model (only summarization step)

**Pattern 2 & 3 Comprehensive Support**:
- Full processing pipeline analysis (OCR, Classification, Extraction, Assessment, Summarization)
- Bedrock OCR token validation when configured
- UDOP classification support for Pattern 3
- Complete latency distribution modeling and quota analysis

### 3. Data Import/Export and Integration

**CSV Import/Export Functionality**:
- Document configuration CSV import with validation
- Processing schedule CSV import/export
- Capacity plan export with comprehensive metrics
- Quota requirements export for documentation and planning

**Document Context Integration**:
- Integration with Documents context for processed document access
- Automatic document filtering by completion status
- Document picker modal with multi-select capability
- Real-time document data validation and error handling

**Configuration Integration**:
- Dynamic model configuration from "View/Edit Configuration"
- Real-time configuration updates without page refresh
- Pattern-specific model display in token configuration tables
- Environment variable-based configuration management

## Troubleshooting and Best Practices

### Common Issues and Solutions

**Configuration Not Loaded**:
- **Symptom**: Warning message "Configuration not loaded"
- **Diagnosis**: Pattern configuration not available from "View/Edit Configuration"
- **Solution**: Visit "View/Edit Configuration" tab first to load pattern configuration

**No Documents Available for Token Population**:
- **Symptom**: Alert "No documents available. Please visit the Documents tab first"
- **Diagnosis**: Documents context not loaded or no processed documents
- **Solution**: Visit Documents tab to load document data, then return to Capacity Planning

**Missing OCR Tokens Validation Error**:
- **Symptom**: "OCR tokens are required for all document types when Bedrock OCR is configured"
- **Diagnosis**: Bedrock OCR is configured but OCR token values are missing
- **Solution**: Populate OCR tokens from processed documents or manually enter values

**Empty Quota Requirements**:
- **Symptom**: "No quota requirements found" with debug information
- **Diagnosis**: No token usage configured or calculation returned empty results
- **Solution**: Configure document processing with token values and ensure processing schedule has volumes > 0

**Missing Environment Variable Configuration**:
- **Symptom**: Warning messages about missing environment variables (e.g., `VITE_BDA_TOKENS_PER_PAGE`, `VITE_LATENCY_OPTIONS`)
- **Diagnosis**: Required environment variables not configured in `.env` file
- **Solution**: Configure missing environment variables with appropriate values

**VITE_BEDROCK_MODEL_QUOTA_CODES Not Configured**:
- **Symptom**: "Request Increase" buttons open generic Bedrock quotas page instead of specific quota
- **Diagnosis**: `VITE_BEDROCK_MODEL_QUOTA_CODES` environment variable not configured (this is normal)
- **Solution**: This is expected behavior - manually navigate to specific quotas in AWS console

### Best Practices

**Capacity Planning Workflow**:
1. **Prerequisites**: Process sample documents first to generate metering data
2. **Configuration**: Load pattern configuration via "View/Edit Configuration"
3. **Token Population**: Use "Populate tokens from Documents" for accurate token usage
4. **Schedule Configuration**: Define realistic processing schedules based on business requirements
5. **Validation**: Run capacity calculations to identify quota requirements and performance issues

**Token Usage Management**:
- Use actual processed documents for token population rather than estimates
- Validate OCR token requirements when Bedrock OCR is configured
- Export configurations as CSV for backup and version control
- Monitor token usage patterns and adjust configurations as processing evolves

**Quota Management**:
- Request quota increases proactively based on capacity analysis
- Use direct AWS console links for efficient quota management
- Monitor quota utilization percentages to avoid service limits
- Document quota requirements for compliance and planning purposes

**Performance Optimization**:
- Analyze peak hour token distribution to optimize processing schedules
- Monitor latency distribution percentiles against SLA requirements
- Use pattern-specific optimizations based on deployment configuration
- Export capacity plans for stakeholder review and approval

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