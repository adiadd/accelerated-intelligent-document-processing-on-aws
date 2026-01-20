# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import boto3
import os
from typing import Dict, Any

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    GraphQL resolver for calculateCapacity query.
    Invokes the calculate_capacity Lambda function and returns the result.
    """
    try:
        # Get the input from GraphQL arguments
        input_data = event.get('arguments', {}).get('input', '{}')
        print(f"Received input_data: {input_data}")
        
        # Get the calculate_capacity function name from environment
        calculate_capacity_function = os.environ.get('CALCULATE_CAPACITY_FUNCTION_NAME')
        if not calculate_capacity_function:
            print("ERROR: Calculate capacity function not configured")
            return {
                'success': False,
                'errorMessage': 'Calculate capacity function not configured',
                'data': None
            }
        
        print(f"Invoking function: {calculate_capacity_function}")
        
        # Invoke the calculate_capacity Lambda function
        lambda_client = boto3.client('lambda')
        
        response = lambda_client.invoke(
            FunctionName=calculate_capacity_function,
            InvocationType='RequestResponse',
            Payload=json.dumps({
                'body': input_data
            })
        )
        
        print(f"Lambda response status: {response.get('StatusCode')}")
        
        # Parse the response
        payload = json.loads(response['Payload'].read())
        print(f"Lambda payload: {payload}")
        
        if response.get('StatusCode') == 200:
            # The calculate_capacity function returns the result directly, not wrapped in body
            # If there's a body field, parse it as JSON, otherwise use the payload directly
            if 'body' in payload:
                try:
                    # The body field contains JSON string, parse it and return as object
                    body_data = json.loads(payload['body']) if isinstance(payload['body'], str) else payload['body']
                    print(f"Parsed body data: {body_data}")
                    print(f"Body data keys: {list(body_data.keys()) if isinstance(body_data, dict) else 'Not a dict'}")
                    return body_data  # Return as object, not JSON string
                except (json.JSONDecodeError, TypeError) as e:
                    print(f"Error parsing body: {e}")
                    return {
                        'success': False,
                        'errorMessage': f'Error parsing response: {str(e)}',
                        'data': None
                    }
            else:
                # Return the payload directly as object
                print(f"No body field, returning payload directly: {payload}")
                return payload
        else:
            error_msg = f'Capacity calculation service returned status {response.get("StatusCode")}'
            if 'FunctionError' in response:
                error_msg += f' with error: {response["FunctionError"]}'
            if payload and 'errorMessage' in payload:
                error_msg += f' - {payload["errorMessage"]}'
            print(f"ERROR: {error_msg}")
            return {
                'success': False,
                'errorMessage': error_msg,
                'data': None
            }
            
    except Exception as e:
        print(f"Error in calculateCapacity resolver: {str(e)}")
        return {
            'success': False,
            'errorMessage': f'Internal error: {str(e)}',
            'data': None
        }
