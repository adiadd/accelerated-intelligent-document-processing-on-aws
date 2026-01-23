# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
# Updated: 2024-10-17 16:31 - OCR quota fix

import json
import os
import time
from decimal import Decimal
from typing import Any, Dict

import boto3
from botocore.exceptions import ClientError


def convert_decimal_to_float(obj):
    """Convert DynamoDB Decimal types to Python float/int for JSON serialization and math operations."""
    if isinstance(obj, Decimal):
        # Convert to int if it's a whole number, otherwise float
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    elif isinstance(obj, dict):
        return {k: convert_decimal_to_float(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimal_to_float(item) for item in obj]
    return obj


def retry_with_backoff(func, max_retries=3, base_delay=1):
    """Retry function with exponential backoff for API rate limiting."""
    for attempt in range(max_retries):
        try:
            return func()
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', '')
            if error_code in ['Throttling', 'TooManyRequestsException', 'RequestLimitExceeded']:
                if attempt < max_retries - 1:
                    delay = base_delay * (2 ** attempt)
                    print(f"⏳ Rate limited, retrying in {delay}s (attempt {attempt + 1}/{max_retries})")
                    time.sleep(delay)
                    continue
            raise e
        except Exception as e:
            if attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                print(f"⏳ API error, retrying in {delay}s (attempt {attempt + 1}/{max_retries}): {e}")
                time.sleep(delay)
                continue
            raise e
    return None


def get_real_latency_metrics(pattern):
    """Get processing times from environment configuration."""
    processing_times_config = os.environ.get("PROCESSING_TIMES_CONFIG")
    if not processing_times_config:
        raise ValueError("PROCESSING_TIMES_CONFIG environment variable not set")

    try:
        base_times_config = json.loads(processing_times_config)
        if pattern not in base_times_config:
            raise ValueError(f"Pattern {pattern} not found in PROCESSING_TIMES_CONFIG")
        base_times = base_times_config[pattern]
    except json.JSONDecodeError:
        raise ValueError("PROCESSING_TIMES_CONFIG contains invalid JSON")

    if not base_times:
        raise ValueError(f"No processing times configured for pattern {pattern}")

    variance_factor = float(os.environ["PROCESSING_VARIANCE_FACTOR"])

    return {
        "base_times": base_times,
        "variance_factor": variance_factor,
        "data_source": "environment_config",
    }


def generate_adaptive_recommendations(
    latency_distribution,
    quota_requirements,
    total_docs_per_hour,
    pattern,
    document_configs,
):
    """Generate adaptive recommendations based on enhanced analysis - requires all configuration."""
    recommendations = []

    # Basic processing info with data source
    data_source = latency_distribution.get("dataSource", "unknown")
    source_text = (
        "environment configuration"
        if data_source == "environment_config"
        else "unknown source"
    )
    recommendations.append(
        f"Processing {int(total_docs_per_hour)} documents/hour using {pattern.upper()} (based on {source_text})"
    )

    # Require complexity analysis configuration
    complexity_factor = float(
        latency_distribution.get("complexityFactor", "1.0").rstrip("x")
    )
    high_complexity_threshold = float(os.environ["RECOMMENDATION_HIGH_COMPLEXITY_THRESHOLD"])
    medium_complexity_threshold = float(os.environ["RECOMMENDATION_MEDIUM_COMPLEXITY_THRESHOLD"])

    if complexity_factor > high_complexity_threshold:
        recommendations.append(
            "⚠️ High document complexity detected - consider document preprocessing or splitting"
        )
    elif complexity_factor > medium_complexity_threshold:
        recommendations.append(
            "📊 Medium document complexity - monitor processing times and consider optimization"
        )

    # Require load analysis configuration
    load_factor = float(latency_distribution.get("loadFactor", "1.0").rstrip("x"))
    high_load_threshold = float(os.environ["RECOMMENDATION_HIGH_LOAD_THRESHOLD"])
    medium_load_threshold = float(os.environ["RECOMMENDATION_MEDIUM_LOAD_THRESHOLD"])

    if load_factor > high_load_threshold:
        recommendations.append(
            "🚨 High system load - increase quotas, add processing capacity, or distribute load across time"
        )
    elif load_factor > medium_load_threshold:
        recommendations.append(
            "⚠️ Moderate system load - monitor for bottlenecks and plan capacity increases"
        )

    # Require latency analysis configuration
    p99_seconds = float(latency_distribution.get("p99", "0s").rstrip("s"))
    high_latency_threshold = int(os.environ["RECOMMENDATION_HIGH_LATENCY_THRESHOLD"])

    if p99_seconds > high_latency_threshold:
        recommendations.append(
            f"🐌 High P99 latency ({p99_seconds:.0f}s) - optimize document preprocessing or increase infrastructure capacity"
        )

    # Infrastructure-based recommendations
    if latency_distribution.get("exceedsLimit"):
        recommendations.append(
            "⏰ Processing time exceeds SLA - consider increasing timeouts or reducing document complexity"
        )

    # Quota analysis with specific actions
    quota_warnings = [
        req for req in quota_requirements if req.get("status") == "warning"
    ]
    if quota_warnings:
        model_names = [req.get("modelId", "Unknown") for req in quota_warnings[:3]]
        recommendations.append(
            f"📈 {len(quota_warnings)} quota increases needed for: {', '.join(model_names)}"
        )

    # Bottleneck analysis with specific guidance
    bottlenecks = latency_distribution.get("bottlenecks", [])
    if bottlenecks:
        recommendations.append(
            f"🔍 Performance bottlenecks: {', '.join(bottlenecks)} - consider scaling these services"
        )

    # Document-specific recommendations - require configuration
    if document_configs:
        large_doc_threshold = int(os.environ["RECOMMENDATION_LARGE_DOC_THRESHOLD"])
        high_token_docs = [
            doc
            for doc in document_configs
            if (doc.get("ocrTokens", 0) + doc.get("extractionTokens", 0))
            > large_doc_threshold
        ]
        if high_token_docs:
            recommendations.append(
                f"📄 {len(high_token_docs)} document types exceed {large_doc_threshold} tokens - consider splitting for better performance"
            )

        # Page-based recommendations - require configuration
        high_page_threshold = int(os.environ["RECOMMENDATION_HIGH_PAGE_THRESHOLD"])
        high_page_docs = [
            doc
            for doc in document_configs
            if doc.get("avgPages", 1) > high_page_threshold
        ]
        if high_page_docs:
            recommendations.append(
                f"📑 {len(high_page_docs)} document types have >{high_page_threshold} pages - consider parallel processing"
            )

    # Pattern-specific recommendations
    if pattern == "pattern-1" and total_docs_per_hour > 100:
        recommendations.append(
            "🔄 High volume BDA processing - ensure adequate BDA quota and consider batch optimization"
        )
    elif pattern == "pattern-3" and total_docs_per_hour > 50:
        recommendations.append(
            "🤖 High volume SageMaker classification - consider auto-scaling endpoint configuration"
        )

    # Infrastructure optimization recommendations
    variance_factor = float(
        latency_distribution.get("varianceFactor", "1.0").rstrip("x")
    )
    if variance_factor > 3.0:
        recommendations.append(
            "📈 High latency variance detected - consider implementing request queuing or load balancing"
        )

    return recommendations


def generate_rpm_quota_codes(model_ids):
    """Generate RPM quota codes dynamically based on model patterns from environment configuration."""
    rpm_quotas = {}
    
    # Get RPM quota code mappings from environment
    rpm_mapping_env = os.environ.get("BEDROCK_MODEL_RPM_QUOTA_CODES")
    if not rpm_mapping_env:
        raise ValueError("BEDROCK_MODEL_RPM_QUOTA_CODES environment variable not set")
    
    try:
        rpm_mapping = json.loads(rpm_mapping_env)
    except json.JSONDecodeError:
        raise ValueError("BEDROCK_MODEL_RPM_QUOTA_CODES must be valid JSON")
    
    for model_id in model_ids:
        # First try exact match
        if model_id in rpm_mapping:
            rpm_quotas[model_id] = rpm_mapping[model_id]
            continue
            
        # Clean model ID by removing region prefix and version suffixes
        clean_model_id = model_id.lower()
        if '.' in clean_model_id:
            clean_model_id = clean_model_id.split('.', 2)[-1]  # Remove region prefix like "us." or "eu."
        clean_model_id = clean_model_id.split(':')[0]  # Remove version suffix like ":1m"
        
        # Try to match against cleaned mapping keys
        matched = False
        for model_type, quota_code in rpm_mapping.items():
            # Clean the mapping key the same way for comparison
            clean_mapping_key = model_type.lower()
            if '.' in clean_mapping_key:
                clean_mapping_key = clean_mapping_key.split('.', 2)[-1]
            clean_mapping_key = clean_mapping_key.split(':')[0]
            
            # Match if the cleaned keys are equal or one contains the other
            if clean_model_id == clean_mapping_key or clean_model_id in clean_mapping_key or clean_mapping_key in clean_model_id:
                rpm_quotas[model_id] = quota_code
                matched = True
                break
        
        # If no match found, raise error instead of using default
        if not matched:
            raise ValueError(f"No RPM quota code mapping found for model {model_id}. Please add mapping to BEDROCK_MODEL_RPM_QUOTA_CODES environment variable.")
    
    return rpm_quotas


def get_simple_quotas():
    """Get AWS service quotas from live API for both TPM and RPM."""
    quotas = {"bedrock": None, "bedrock_models": {}, "bedrock_models_rpm": {}}

    try:
        quotas_client = boto3.client("service-quotas")
        region = boto3.Session().region_name
        print(f"🔍 Retrieving quotas from Service Quotas API in region: {region}")

        # Get TPM quota codes
        tpm_quota_codes_env = os.environ.get("BEDROCK_MODEL_QUOTA_CODES")
        if not tpm_quota_codes_env:
            raise ValueError("BEDROCK_MODEL_QUOTA_CODES environment variable not set")

        try:
            tpm_model_quotas = json.loads(tpm_quota_codes_env)
        except json.JSONDecodeError:
            raise ValueError("BEDROCK_MODEL_QUOTA_CODES must be valid JSON")

        # Generate RPM quota codes dynamically
        rpm_model_quotas = generate_rpm_quota_codes(tpm_model_quotas.keys())

        retrieved_count = 0

        # Test API access and discover available quotas
        try:
            test_response = quotas_client.list_service_quotas(
                ServiceCode="bedrock", MaxResults=100
            )
            available_quotas = test_response.get("Quotas", [])
            print(f"✅ Service Quotas API accessible, found {len(available_quotas)} bedrock quotas")
            
            # Log Nova-related quotas for debugging
            nova_quotas = [q for q in available_quotas if 'nova' in q.get('QuotaName', '').lower()]
            if nova_quotas:
                print("🔍 Found Nova-related quotas:")
                for quota in nova_quotas[:5]:  # Show first 5
                    print(f"  - {quota.get('QuotaName')}: {quota.get('QuotaCode')} = {quota.get('Value')}")
            else:
                print("⚠️ No Nova-related quotas found in Service Quotas API")
                
        except Exception as e:
            print(f"❌ Cannot access Service Quotas API: {type(e).__name__} - {str(e)}")
            raise e

        # Retrieve TPM quotas
        for model_id, quota_code in tpm_model_quotas.items():
            try:
                print(f"🔍 Requesting TPM quota for {model_id} with code {quota_code}...")
                
                def get_tpm_quota():
                    return quotas_client.get_service_quota(
                        ServiceCode="bedrock", QuotaCode=quota_code
                    )
                
                model_quota = retry_with_backoff(get_tpm_quota)
                quota_value = int(model_quota["Quota"]["Value"])
                quotas["bedrock_models"][model_id] = quota_value
                print(f"✅ Retrieved {model_id} TPM quota: {quota_value}")
                retrieved_count += 1
                
                # Small delay to prevent rate limiting
                time.sleep(0.1)
            except Exception as e:
                print(f"⚠️ Failed to get TPM quota for {model_id}: {e}")
                raise ValueError(f"TPM quota not available for model {model_id}. Please ensure the model has proper quota codes in BEDROCK_MODEL_QUOTA_CODES environment variable.")

        # Retrieve RPM quotas with fallback
        for model_id, quota_code in rpm_model_quotas.items():
            try:
                print(f"🔍 Requesting RPM quota for {model_id} with code {quota_code}...")
                
                def get_rpm_quota():
                    return quotas_client.get_service_quota(
                        ServiceCode="bedrock", QuotaCode=quota_code
                    )
                
                model_quota = retry_with_backoff(get_rpm_quota)
                quota_value = int(model_quota["Quota"]["Value"])
                quotas["bedrock_models_rpm"][model_id] = quota_value
                print(f"✅ Retrieved {model_id} RPM quota: {quota_value}")
                retrieved_count += 1
                
                # Small delay to prevent rate limiting
                time.sleep(0.1)
            except Exception as e:
                print(f"⚠️ Failed to get RPM quota for {model_id}: {e}")
                # Raise error if RPM quota not found - no defaults
                raise ValueError(f"RPM quota not available for model {model_id}. Please configure proper quota codes.")

        print(f"📊 Retrieved {retrieved_count} quotas from AWS Service Quotas API")

        if quotas["bedrock_models"]:
            quotas["bedrock"] = max(quotas["bedrock_models"].values())
        else:
            raise ValueError("No TPM quotas retrieved from AWS Service Quotas API")

    except Exception as e:
        print(f"❌ Service Quotas API error: {e}")
        raise ValueError(
            f"Cannot retrieve quotas from AWS Service Quotas API: {str(e)}"
        )

    return quotas


def calculate_document_complexity_factor(document_configs):
    """Calculate complexity factor based on document characteristics."""
    if not document_configs:
        return 1.0

    # Document complexity thresholds from environment
    medium_complexity_threshold = int(os.environ["MEDIUM_COMPLEXITY_THRESHOLD"])
    high_complexity_threshold = int(os.environ["HIGH_COMPLEXITY_THRESHOLD"])
    page_complexity_factor = float(os.environ["PAGE_COMPLEXITY_FACTOR"])
    high_complexity_multiplier = float(os.environ["HIGH_COMPLEXITY_MULTIPLIER"])
    medium_complexity_multiplier = float(os.environ["MEDIUM_COMPLEXITY_MULTIPLIER"])

    total_complexity = 0
    total_docs = 0

    for doc_config in document_configs:
        docs_count = doc_config.get("docsPerHour", 0)
        if docs_count == 0:
            continue

        # Base complexity factors
        pages = doc_config.get("avgPages", 1)
        page_factor = 1.0 + (pages - 1) * page_complexity_factor

        # Token density indicates document complexity
        total_tokens = (
            doc_config.get("ocrTokens", 0)
            + doc_config.get("classificationTokens", 0)
            + doc_config.get("extractionTokens", 0)
        )
        tokens_per_page = total_tokens / pages if pages > 0 else 0

        # Complexity based on token density
        if tokens_per_page > high_complexity_threshold:
            complexity_factor = high_complexity_multiplier
        elif tokens_per_page > medium_complexity_threshold:
            complexity_factor = medium_complexity_multiplier
        else:
            complexity_factor = 1.0

        doc_complexity = page_factor * complexity_factor
        total_complexity += doc_complexity * docs_count
        total_docs += docs_count

    if total_docs == 0:
        return 1.0

    return total_complexity / total_docs

    if total_docs == 0:
        raise ValueError("No documents configured for processing")

    return total_complexity / total_docs


def calculate_latency_distribution(
    docs_per_hour,
    pages_per_hour,
    tokens_per_hour,
    pattern,
    max_allowed_latency,
    quotas,
    document_configs=None,
):
    """
    Calculate latency distribution using simplified approach.
    Quota capacity determines processing speed - insufficient quota causes throttling and delays.
    """

    # max_allowed_latency is in minutes
    max_allowed_minutes = max_allowed_latency

    # Get processing capacity from quotas - no defaults
    bedrock_quota_tpm = quotas.get("bedrock")
    if not bedrock_quota_tpm:
        raise ValueError("Bedrock TPM quota not configured")
    
    bedrock_quota_rpm = quotas.get("bedrock_models_rpm", {})
    if not bedrock_quota_rpm:
        raise ValueError("Bedrock RPM quotas not configured")
    
    # Calculate effective processing capacity with realistic token estimation
    total_tokens = sum(tokens_per_hour.values()) if isinstance(tokens_per_hour, dict) else tokens_per_hour
    min_tokens_per_request = int(os.environ["MIN_TOKENS_PER_REQUEST"])
    
    # Calculate actual average tokens per request
    actual_avg_tokens = total_tokens / max(docs_per_hour, 1) if docs_per_hour > 0 else 0
    
    # Use actual tokens if reasonable, otherwise use minimum for safety
    if actual_avg_tokens >= min_tokens_per_request:
        avg_tokens_per_request = actual_avg_tokens
        print(f"🔍 Using actual token average: {actual_avg_tokens:.0f} tokens/request")
    else:
        avg_tokens_per_request = min_tokens_per_request
        print(f"⚠️ Using minimum token safety: {min_tokens_per_request} tokens/request (actual: {actual_avg_tokens:.0f})")
        
    # Add warning if using minimum significantly differs from actual
    if actual_avg_tokens > 0 and actual_avg_tokens < min_tokens_per_request * 0.5:
        print(f"⚠️ WARNING: Document tokens ({actual_avg_tokens:.0f}) much lower than minimum ({min_tokens_per_request}). Consider reviewing document configuration.")
    
    # Capacity limited by either tokens or requests with realistic calculations
    token_limited_capacity = bedrock_quota_tpm / avg_tokens_per_request  # docs/min
    request_limited_capacity = min(bedrock_quota_rpm.values()) if bedrock_quota_rpm else 0
    
    effective_capacity = min(token_limited_capacity, request_limited_capacity)
    
    print(f"🔍 Capacity Analysis:")
    print(f"  - Token-limited capacity: {token_limited_capacity:.1f} docs/min ({bedrock_quota_tpm} TPM ÷ {avg_tokens_per_request:.0f} tokens)")
    print(f"  - Request-limited capacity: {request_limited_capacity:.1f} docs/min")
    print(f"  - Effective capacity: {effective_capacity:.1f} docs/min")
    
    # Convert hourly demand to per-minute with validation
    docs_per_minute = docs_per_hour / 60
    
    if docs_per_minute <= 0:
        print("⚠️ WARNING: No document processing demand configured")
        return {
            "p50": "0s", "p75": "0s", "p90": "0s", "p95": "0s", "p99": "0s",
            "maxAllowed": f"{max_allowed_minutes * 60:.1f}s",
            "baseLatency": "0s", "queueLatency": "0min", "totalLatency": "0s",
            "loadFactor": "0x", "complexityFactor": "1.0x", "varianceFactor": "1.0x",
            "pattern": pattern, "exceedsLimit": False, "dataSource": "no_demand",
            "processingRate": f"{effective_capacity:.0f} docs/min",
            "demandRate": "0 docs/min", "quotaUtilization": "0%",
            "warningMessage": "No processing demand configured"
        }
    
    # Simple capacity check: if demand exceeds capacity, we get delays
    if docs_per_minute > effective_capacity:
        # Processing is bottlenecked by quota limits
        utilization = docs_per_minute / effective_capacity
        # Queue builds up when demand exceeds capacity
        queue_latency_minutes = (docs_per_minute - effective_capacity) / effective_capacity * 10  # Simplified queue model
        bottleneck_services = [f"Bedrock Quota Limit ({utilization:.1%} utilization)"]
    else:
        queue_latency_minutes = 0.0
        utilization = docs_per_minute / effective_capacity if effective_capacity > 0 else 0.0
        bottleneck_services = []

    # Base processing time adjusted for SLA requirements
    try:
        latency_data = get_real_latency_metrics(pattern)
        base_times = latency_data["base_times"]
        actual_processing_minutes = sum(base_times.values()) / 60  # Convert to minutes
    except Exception as e:
        raise ValueError(f"Unable to get processing time metrics: {e}")

    # Adjust processing behavior based on SLA - tighter SLA means faster processing
    if max_allowed_minutes > 0:
        sla_adjustment_factor = actual_processing_minutes / max_allowed_minutes
        # If SLA is tighter than actual processing time, we need to process faster
        if sla_adjustment_factor > 1.0:
            # Need to process faster - reduce base processing time
            base_processing_minutes = actual_processing_minutes / sla_adjustment_factor
        else:
            # SLA is looser - can use normal processing time
            base_processing_minutes = actual_processing_minutes
    else:
        base_processing_minutes = actual_processing_minutes

    # Total latency = base processing + queue delay
    total_latency_minutes = base_processing_minutes + queue_latency_minutes
    total_latency_seconds = total_latency_minutes * 60
    
    # Calculate complexity factor
    complexity_factor = calculate_document_complexity_factor(document_configs or [])
    
    # Create realistic percentile distribution
    base_latency_seconds = base_processing_minutes * 60
    queue_latency_seconds = queue_latency_minutes * 60
    
    # Percentiles reflect processing variance and queue delays
    p50_seconds = base_latency_seconds + (queue_latency_seconds * 0.3)
    p75_seconds = base_latency_seconds + (queue_latency_seconds * 0.6)
    p90_seconds = base_latency_seconds + (queue_latency_seconds * 0.8 * complexity_factor)
    p95_seconds = base_latency_seconds + (queue_latency_seconds * 0.9 * complexity_factor)
    p99_seconds = base_latency_seconds + (queue_latency_seconds * 1.0 * complexity_factor)

    # Check if latency exceeds limits
    exceeds_limit = total_latency_minutes > max_allowed_minutes
    warning_message = None

    if exceeds_limit:
        warning_message = f"Processing time ({total_latency_minutes:.1f}min) exceeds SLA ({max_allowed_minutes:.1f}min) due to insufficient quota capacity"

    # Calculate factors for display
    load_factor = utilization
    variance_factor = complexity_factor * (1.0 + max(0, utilization - 1.0) * 0.5)

    result = {
        "p50": f"{p50_seconds:.1f}s",
        "p75": f"{p75_seconds:.1f}s", 
        "p90": f"{p90_seconds:.1f}s",
        "p95": f"{p95_seconds:.1f}s",
        "p99": f"{p99_seconds:.1f}s",
        "maxAllowed": f"{max_allowed_minutes * 60:.1f}s",
        "baseLatency": f"{base_latency_seconds:.1f}s",
        "queueLatency": f"{queue_latency_minutes:.2f}min",
        "totalLatency": f"{total_latency_seconds:.1f}s",
        "loadFactor": f"{load_factor:.2f}x",
        "complexityFactor": f"{complexity_factor:.2f}x", 
        "varianceFactor": f"{variance_factor:.2f}x",
        "pattern": pattern,
        "exceedsLimit": exceeds_limit,
        "dataSource": "quota_capacity_analysis",
        "processingRate": f"{effective_capacity:.0f} docs/min",
        "demandRate": f"{docs_per_minute:.1f} docs/min",
        "quotaUtilization": f"{utilization:.1%}",
    }

    if warning_message:
        result["warningMessage"] = warning_message

    if bottleneck_services:
        result["bottlenecks"] = bottleneck_services

    return result


def build_simple_quota_requirements(
    pages_per_hour,
    tokens_per_hour,
    docs_per_hour,
    quotas,
    max_allowed_latency,
    pattern,
    model_config,
    hourly_breakdown,
    latency_distribution=None,
    document_configs=None,
):
    """Build quota requirements analysis using peak hour demand per inference type."""
    requirements = []

    print(f"Starting quota requirements build for {pattern}")
    print(f"Model config: {model_config}")

    # Calculate peak hour demand for each inference type (no artificial factors)
    peak_ocr_tpm = 0
    peak_classification_tpm = 0
    peak_extraction_tpm = 0
    peak_assessment_tpm = 0
    peak_summarization_tpm = 0

    # Calculate peak demands with SLA-based adjustment using actual processing time
    # Get actual processing time for this pattern
    try:
        latency_data = get_real_latency_metrics(pattern)
        base_times = latency_data["base_times"]
        actual_processing_minutes = sum(base_times.values()) / 60
    except Exception:
        raise ValueError("Unable to get processing time metrics - no baseline available for SLA calculation")
    
    # Scale based on actual processing time vs required SLA
    sla_factor = actual_processing_minutes / max_allowed_latency if max_allowed_latency > 0 else 1.0
    
    for hour_data in hourly_breakdown:
        ocr_tpm = hour_data.get("ocrTokensPerHour", 0) / 60 * sla_factor
        classification_tpm = hour_data["classificationTokensPerHour"] / 60 * sla_factor
        extraction_tpm = hour_data["extractionTokensPerHour"] / 60 * sla_factor
        assessment_tpm = hour_data["assessmentTokensPerHour"] / 60 * sla_factor
        summarization_tpm = hour_data["summarizationTokensPerHour"] / 60 * sla_factor

        peak_ocr_tpm = max(peak_ocr_tpm, ocr_tpm)
        peak_classification_tpm = max(peak_classification_tpm, classification_tpm)
        peak_extraction_tpm = max(peak_extraction_tpm, extraction_tpm)
        peak_assessment_tpm = max(peak_assessment_tpm, assessment_tpm)
        peak_summarization_tpm = max(peak_summarization_tpm, summarization_tpm)

    print(
        f"🔍 Peak demands (SLA factor: {sla_factor:.2f}x - actual: {actual_processing_minutes:.1f}min vs required: {max_allowed_latency}min) - OCR: {peak_ocr_tpm:.0f}, Classification: {peak_classification_tpm:.0f}, Extraction: {peak_extraction_tpm:.0f}, Assessment: {peak_assessment_tpm:.0f}, Summarization: {peak_summarization_tpm:.0f}"
    )

    # Map inference types to their peak demands and models
    inference_demands = {}
    if pattern == "pattern-1":
        # Use only configured models - no defaults
        if model_config.get("summarization_model"):
            inference_demands["Summarization"] = (
                peak_summarization_tpm,
                model_config.get("summarization_model"),
            )
    elif pattern == "pattern-2":
        # Use only configured models - no defaults
        if model_config.get("classification_model"):
            inference_demands["Classification"] = (
                peak_classification_tpm,
                model_config.get("classification_model"),
            )
        if model_config.get("extraction_model"):
            inference_demands["Extraction"] = (peak_extraction_tpm, model_config.get("extraction_model"))
        if model_config.get("assessment_model"):
            inference_demands["Assessment"] = (peak_assessment_tpm, model_config.get("assessment_model"))
        if model_config.get("summarization_model"):
            inference_demands["Summarization"] = (
                peak_summarization_tpm,
                model_config.get("summarization_model"),
            )
        # OCR model configuration required for pattern-2
        ocr_model = model_config.get("ocr_model")
        if ocr_model and ocr_model.strip():
            inference_demands["OCR"] = (peak_ocr_tpm, ocr_model.strip())
    else:  # pattern-3
        # Use only configured models - no defaults
        if model_config.get("extraction_model"):
            inference_demands["Extraction"] = (peak_extraction_tpm, model_config.get("extraction_model"))
        if model_config.get("assessment_model"):
            inference_demands["Assessment"] = (peak_assessment_tpm, model_config.get("assessment_model"))
        if model_config.get("summarization_model"):
            inference_demands["Summarization"] = (
                peak_summarization_tpm,
                model_config.get("summarization_model"),
            )
        # OCR model configuration required for pattern-3
        ocr_model = model_config.get("ocr_model")
        if ocr_model and ocr_model.strip():
            inference_demands["OCR"] = (peak_ocr_tpm, ocr_model.strip())

    # Build requirements for each inference type
    print(f"Processing inference demands: {inference_demands}")

    for step_name, (peak_tpm, model_id) in inference_demands.items():
        print(f"🔍 Processing {step_name}: peak_tpm={peak_tpm}, model_id='{model_id}'")

        # Validate model configuration
        if not model_id:
            print(f"⚠️ Skipping {step_name} - no model configured")
            continue

        # Get TPM model quota - must be available from live AWS API
        model_quota_tpm = quotas.get("bedrock_models", {}).get(model_id)
        if model_quota_tpm is None:
            raise ValueError(f"TPM quota not available for model {model_id} ({step_name}). Please ensure proper quota codes are configured.")

        # Get RPM model quota - must be available from live AWS API  
        model_quota_rpm = quotas.get("bedrock_models_rpm", {}).get(model_id)
        if model_quota_rpm is None:
            raise ValueError(f"RPM quota not available for model {model_id} ({step_name}). Please ensure proper quota codes are configured.")

        print(f"🔍 Retrieved quotas for {model_id} ({step_name}): {model_quota_tpm} TPM, {model_quota_rpm} RPM")

        # Get actual metering data from DynamoDB table - no fallbacks
        import boto3
        
        dynamodb = boto3.resource('dynamodb')
        metering_table_name = os.environ.get('METERING_TABLE_NAME')
        
        if not metering_table_name:
            raise ValueError("METERING_TABLE_NAME not configured")
        
        actual_requests_per_hour = 0
        
        try:
            table = dynamodb.Table(metering_table_name)
            
            # Query recent metering data for this processing step
            response = table.scan(
                FilterExpression=boto3.dynamodb.conditions.Attr('Metering').exists()
            )
            
            print(f"🔍 Found {len(response.get('Items', []))} metering records")
            
            # Debug: Show all metering keys
            for item in response.get('Items', []):
                metering_data = item.get('Metering', {})
                if isinstance(metering_data, str):
                    import json as json_module
                    metering_data = json_module.loads(metering_data)
                # Convert Decimal types to float/int
                metering_data = convert_decimal_to_float(metering_data)
                print(f"🔍 Metering keys: {list(metering_data.keys())}")
                break  # Just show first record
            
            # Sum up requests from metering data
            for item in response.get('Items', []):
                metering_data = item.get('Metering', {})
                if isinstance(metering_data, str):
                    import json as json_module
                    metering_data = json_module.loads(metering_data)
                # Convert Decimal types to float/int for math operations
                metering_data = convert_decimal_to_float(metering_data)
                for key, value in metering_data.items():
                    print(f"🔍 Checking key: {key} for step: {step_name}")
                    # Look for bedrock entries that match the processing step
                    if isinstance(value, dict) and step_name.lower() in key.lower() and 'bedrock' in key.lower():
                        requests = value.get('requests', 0)
                        if requests > 0:
                            # Scale by planned document volume
                            for hour_data in hourly_breakdown:
                                docs_this_hour = hour_data.get("docsPerHour", 0)
                                actual_requests_per_hour += requests * docs_this_hour
                            print(f"🔍 FOUND Metering data: {key} -> {requests} req/doc * {docs_this_hour} docs = {actual_requests_per_hour} req/hour")
                            break  # Found the data, no need to continue
            
            if actual_requests_per_hour == 0:
                raise ValueError(f"No metering data found for {step_name} processing step")
                
        except Exception as e:
            raise ValueError(f"Failed to read metering data for {step_name}: {e}")
        
        peak_rpm = (actual_requests_per_hour / 60) * sla_factor
        
        print(f"🔍 RPM from metering: {actual_requests_per_hour} req/hour * {sla_factor:.2f}x SLA = {peak_rpm:.1f} RPM")

        # Include configured inference types with demand
        should_include = peak_tpm > 0 or peak_rpm > 1.0  # Include if there's meaningful demand

        if should_include:
            print(
                f"✅ Including {step_name} with {peak_tpm} TPM ({peak_rpm:.1f} RPM), quotas: {model_quota_tpm} TPM, {model_quota_rpm} RPM"
            )

            # TPM requirement
            tpm_quota_display = f"{model_quota_tpm:,}"
            tpm_status = "success" if peak_tpm <= model_quota_tpm else "warning"
            if peak_tpm == 0:
                tpm_status_text = "✅ No Demand"
            else:
                tpm_status_text = (
                    "✅ Sufficient" if peak_tpm <= model_quota_tpm else "⚠️ Increase Needed"
                )
            tpm_utilization_percent = (
                min((peak_tpm / model_quota_tpm) * 100, 100)
                if peak_tpm > 0 and model_quota_tpm > 0
                else 0
            )

            # Extract readable model name from model ID
            model_display_name = model_id.split('.')[-1].split(':')[0]  # e.g., "claude-3-haiku-20240307-v1"
            
            tpm_requirement = {
                "service": f"{step_name} ({model_display_name}) - TPM",
                "category": "Bedrock Models TPM",
                "currentQuota": tpm_quota_display,
                "requiredQuota": f"{round(peak_tpm):,}",
                "status": tpm_status,
                "statusText": tpm_status_text,
                "utilizationPercent": tpm_utilization_percent,
                "usedFor": step_name,
                "modelId": model_id,
                "quotaType": "TPM",
            }
            requirements.append(tpm_requirement)

            # RPM requirement
            rpm_quota_display = f"{model_quota_rpm:,}"
            rpm_status = "success" if peak_rpm <= model_quota_rpm else "warning"
            if peak_rpm == 0:
                rpm_status_text = "✅ No Demand"
            else:
                rpm_status_text = (
                    "✅ Sufficient" if peak_rpm <= model_quota_rpm else "⚠️ Increase Needed"
                )
            rpm_utilization_percent = (
                min((peak_rpm / model_quota_rpm) * 100, 100)
                if peak_rpm > 0 and model_quota_rpm > 0
                else 0
            )

            rpm_requirement = {
                "service": f"{step_name} ({model_display_name}) - RPM",
                "category": "Bedrock Models RPM",
                "currentQuota": rpm_quota_display,
                "requiredQuota": f"{round(peak_rpm):,}",
                "status": rpm_status,
                "statusText": rpm_status_text,
                "utilizationPercent": rpm_utilization_percent,
                "usedFor": step_name,
                "modelId": model_id,
                "quotaType": "RPM",
            }
            requirements.append(rpm_requirement)
        else:
            print(f"❌ Skipping {step_name} - no demand (peak_tpm={peak_tpm})")

    print(f"Built {len(requirements)} quota requirements")
    return requirements


def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """Simplified capacity calculation function with proper JSON handling."""

    try:
        print(f"Received event: {json.dumps(event, default=str)}")

        # Handle different event formats (direct call vs GraphQL resolver)
        if "body" in event:
            # Called from GraphQL resolver
            body_data = event["body"]
            if isinstance(body_data, str):
                # Validate and parse JSON
                try:
                    input_data = json.loads(body_data)
                except json.JSONDecodeError as e:
                    print(f"❌ JSON decode error: {e}")
                    print(f"❌ Problematic JSON: {body_data[:500]}...")
                    return {
                        "statusCode": 400,
                        "body": json.dumps(
                            {
                                "success": False,
                                "errorMessage": f"Invalid JSON format: {str(e)}. Please check the request format.",
                            }
                        ),
                    }
            else:
                input_data = body_data
        else:
            # Direct call format
            input_data = event.get("arguments", {}).get("input", {})

        # Parse input for capacity calculation
        document_configs = input_data.get("documentConfigs", [])
        pattern = input_data.get("pattern", "pattern-2")

        print(f"🔍 DEBUG: input_data keys: {list(input_data.keys())}")
        print(
            f"🔍 DEBUG: maxAllowedLatency value: {input_data.get('maxAllowedLatency')}"
        )

        # Normalize pattern format and validate Pattern 2 only
        if pattern.startswith("PATTERN-"):
            pattern = pattern.lower()

        if pattern != "pattern-2":
            print(f"❌ Unsupported pattern: {pattern}")
            error_result = {
                "success": False,
                "errorMessage": f"Only Pattern 2 is supported for capacity planning. Received: {pattern}",
            }
            if "body" in event:
                return {"statusCode": 400, "body": json.dumps(error_result)}
            else:
                return error_result

        max_allowed_latency = input_data.get("maxAllowedLatency") or input_data.get(
            "max_allowed_latency"
        )
        if max_allowed_latency:
            max_allowed_latency = float(max_allowed_latency)
        else:
            raise ValueError("maxAllowedLatency or max_allowed_latency is required")

        if not document_configs:
            error_result = {
                "success": False,
                "errorMessage": "No document configurations provided",
            }
            if "body" in event:
                return {"statusCode": 400, "body": json.dumps(error_result)}
            else:
                return error_result

        # Parse user config with proper error handling
        user_config_str = input_data.get("userConfig", "{}")
        user_config = {}
        if isinstance(user_config_str, str):
            if user_config_str.strip() and user_config_str.strip() != "{}":
                try:
                    user_config = json.loads(user_config_str)
                except json.JSONDecodeError as e:
                    print(f"⚠️ Error parsing user config: {e}, using empty config")
                    user_config = {}
        elif isinstance(user_config_str, dict):
            user_config = user_config_str

        # Get model configuration
        model_config = {
            "classification_model": user_config.get("classification_model", ""),
            "extraction_model": user_config.get("extraction_model", ""),
            "assessment_model": user_config.get("assessment_model", ""),
            "summarization_model": user_config.get("summarization_model", ""),
            "ocr_model": user_config.get("ocr_model", ""),
        }

        print(f"Model config for quota builder: {model_config}")

        # Get quotas with Applied account-level values
        quotas = get_simple_quotas()

        # Process time slots with proper JSON handling
        time_slots = []
        if "timeSlots" in input_data:
            time_slots_json = input_data["timeSlots"]
            if isinstance(time_slots_json, str):
                try:
                    time_slots = json.loads(time_slots_json)
                except json.JSONDecodeError as e:
                    print(f"⚠️ Error parsing time slots: {e}")
                    time_slots = []
            else:
                time_slots = time_slots_json

        # Initialize all 24 hours with zero values
        hourly_breakdown = {}
        for hour in range(24):
            hourly_breakdown[hour] = {
                "hour": hour,
                "docsPerHour": 0,
                "pagesPerHour": 0,
                "tokensPerHour": 0,
                "ocrTokensPerHour": 0,  # Add OCR tokens tracking
                "classificationTokensPerHour": 0,
                "extractionTokensPerHour": 0,
                "assessmentTokensPerHour": 0,
                "summarizationTokensPerHour": 0,
                "documentType": "No processing scheduled",
            }

        # Process each time slot
        for slot in time_slots:
            hour = int(slot.get("hour", 0))
            doc_type = slot.get("documentType", "Unknown")
            docs_per_hour = int(slot.get("docsPerHour", 0))

            if docs_per_hour > 0:
                # Find document config for this type
                doc_config = next(
                    (dc for dc in document_configs if dc.get("type") == doc_type), {}
                )
                avg_pages = doc_config.get("avgPages", 1)
                ocr_tokens = doc_config.get("ocrTokens", 0)  # Add OCR tokens
                classification_tokens = doc_config.get("classificationTokens", 0)
                extraction_tokens = doc_config.get("extractionTokens", 0)
                summarization_tokens = doc_config.get("summarizationTokens", 0)
                assessment_tokens = doc_config.get("assessmentTokens", 0)

                print(
                    f"🔍 Hour {hour}, DocType: {doc_type}, DocsPerHour: {docs_per_hour}, OCR tokens: {ocr_tokens}"
                )

                # Update hourly breakdown
                hourly_breakdown[hour]["docsPerHour"] += docs_per_hour
                hourly_breakdown[hour]["pagesPerHour"] += docs_per_hour * avg_pages
                hourly_breakdown[hour]["ocrTokensPerHour"] += (
                    ocr_tokens * docs_per_hour
                )  # Add OCR tokens
                hourly_breakdown[hour]["classificationTokensPerHour"] += (
                    classification_tokens * docs_per_hour
                )
                hourly_breakdown[hour]["extractionTokensPerHour"] += (
                    extraction_tokens * docs_per_hour
                )
                hourly_breakdown[hour]["assessmentTokensPerHour"] += (
                    assessment_tokens * docs_per_hour
                )
                hourly_breakdown[hour]["summarizationTokensPerHour"] += (
                    summarization_tokens * docs_per_hour
                )

                # Pattern-1 (BDA) only uses summarization tokens
                if pattern == "pattern-1":
                    total_tokens_for_slot = summarization_tokens * docs_per_hour
                else:
                    total_tokens_for_slot = (
                        ocr_tokens
                        + classification_tokens
                        + extraction_tokens
                        + assessment_tokens
                        + summarization_tokens
                    ) * docs_per_hour
                hourly_breakdown[hour]["tokensPerHour"] += total_tokens_for_slot
                hourly_breakdown[hour]["documentType"] = doc_type

        # Convert to list for all 24 hours
        hourly_breakdown_list = []
        for hour in range(24):
            hourly_breakdown_list.append(hourly_breakdown[hour])

        # Calculate totals
        total_docs_per_hour = 0
        total_pages_per_hour = 0
        total_tokens_per_hour = 0

        for doc_config in document_configs:
            docs_per_hour_config = doc_config.get("docsPerHour", 0)
            avg_pages = doc_config.get("avgPages", 1)

            ocr_tokens_per_doc = doc_config.get("ocrTokens", 0)
            classification_tokens_per_doc = doc_config.get("classificationTokens", 0)
            extraction_tokens_per_doc = doc_config.get("extractionTokens", 0)
            summarization_tokens_per_doc = doc_config.get("summarizationTokens", 0)
            assessment_tokens_per_doc = doc_config.get("assessmentTokens", 0)

            # Pattern-1 (BDA) only uses summarization tokens
            if pattern == "pattern-1":
                doc_total_tokens = summarization_tokens_per_doc
            else:
                doc_total_tokens = (
                    ocr_tokens_per_doc
                    + classification_tokens_per_doc
                    + extraction_tokens_per_doc
                    + assessment_tokens_per_doc
                    + summarization_tokens_per_doc
                )

            total_docs_per_hour += docs_per_hour_config
            total_pages_per_hour += docs_per_hour_config * avg_pages
            total_tokens_per_hour += doc_total_tokens * docs_per_hour_config

        # Calculate latency distribution based on processing pattern and load
        latency_distribution = calculate_latency_distribution(
            total_docs_per_hour,
            total_pages_per_hour,
            total_tokens_per_hour,
            pattern,
            max_allowed_latency,
            quotas,
            document_configs,
        )

        # Build quota requirements using Applied account-level quota values
        quota_requirements = build_simple_quota_requirements(
            total_pages_per_hour,
            total_tokens_per_hour,
            total_docs_per_hour,
            quotas,
            max_allowed_latency,
            pattern,
            model_config,
            hourly_breakdown_list,
            latency_distribution,  # Pass latency distribution for concurrency calculation
            document_configs,  # Pass document configs for request count data
        )

        print(f"Returning {len(quota_requirements)} quota requirements")

        # Build result
        result = {
            "success": True,
            "metrics": [
                {"label": "Total Docs", "value": f"{int(total_docs_per_hour):,}"},
                {"label": "Total Pages", "value": f"{int(total_pages_per_hour):,}"},
                {
                    "label": "Total Tokens",
                    "value": f"{total_tokens_per_hour / 1000000:.2f}M",
                },
            ],
            "quotaRequirements": quota_requirements,
            "latencyDistribution": latency_distribution,
            "hourlyBreakdown": hourly_breakdown_list,
            "calculationDetails": {
                "totalDocsPerHour": total_docs_per_hour,
                "totalPagesPerHour": total_pages_per_hour,
                "totalTokensPerHour": total_tokens_per_hour,
                "quotasUsed": quotas,
            },
            "recommendations": generate_adaptive_recommendations(
                latency_distribution,
                quota_requirements,
                total_docs_per_hour,
                pattern,
                document_configs,
            ),
            "errorMessage": None,
        }

        # Return in format expected by GraphQL resolver if called from resolver
        if "body" in event:
            return {"statusCode": 200, "body": json.dumps(result)}
        else:
            return result

    except Exception as e:
        print(f"❌ Error in lambda_handler: {str(e)}")
        import traceback

        traceback.print_exc()

        error_result = {
            "success": False,
            "errorMessage": f"Capacity calculation failed: {str(e)}",
        }

        if "body" in event:
            return {"statusCode": 500, "body": json.dumps(error_result)}
        else:
            return error_result
