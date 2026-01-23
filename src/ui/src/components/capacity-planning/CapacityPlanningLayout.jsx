// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable react/no-unstable-nested-components, react/no-array-index-key */
import React, { useState, useMemo, useEffect } from 'react';
import { generateClient } from 'aws-amplify/api';
import {
  Container,
  Header,
  SpaceBetween,
  Box,
  Button,
  FormField,
  Input,
  Select,
  Table,
  Alert,
  Cards,
  ColumnLayout,
  Badge,
  Modal,
  Checkbox,
} from '@cloudscape-design/components';
import useConfiguration from '../../hooks/use-configuration';
import useSettingsContext from '../../contexts/settings';
import useDocumentsContext from '../../contexts/documents';

const client = generateClient();

const CapacityPlanningLayout = () => {
  const { mergedConfig: configuration, fetchConfiguration } = useConfiguration();
  const { settings: deploymentSettings } = useSettingsContext() || {};
  const { documents } = useDocumentsContext() || {};

  const [manualPattern, setManualPattern] = useState(null);
  // Function to fetch actual page counts from processed documents
  const fetchActualPageCounts = async () => {
    try {
      // Query the tracking table directly for processed documents with page counts
      const query = `
        query ListDocuments($limit: Int) {
          listDocuments(limit: $limit) {
            items {
              documentId
              inputKey
              numberOfPages
              documentType
              status
            }
          }
        }
      `;

      const result = await client.graphql({
        query,
        variables: { limit: 1000 },
      });

      const processedDocuments = result.data?.listDocuments?.items || [];
      const pageCountMap = {};
      const docTypeStats = {};

      console.log('📄 Found documents:', processedDocuments.length);

      // Calculate average pages per document type from completed documents
      processedDocuments.forEach((doc) => {
        if (doc.numberOfPages && doc.documentType && doc.status === 'COMPLETED') {
          const docType = doc.documentType;
          const pages = parseInt(doc.numberOfPages, 10);

          if (!docTypeStats[docType]) {
            docTypeStats[docType] = { totalPages: 0, count: 0 };
          }

          docTypeStats[docType].totalPages += pages;
          docTypeStats[docType].count += 1;
        }
      });

      // Calculate averages
      Object.keys(docTypeStats).forEach((docType) => {
        const stats = docTypeStats[docType];
        pageCountMap[docType] = (stats.totalPages / stats.count).toFixed(1);
      });

      console.log('📄 Calculated page counts from processed documents:', pageCountMap);
      return pageCountMap;
    } catch (error) {
      console.warn('Could not fetch actual page counts from processed documents:', error);
      return {};
    }
  };

  // Auto-populate avgPages from processed documents on component mount
  useEffect(() => {
    const populatePageCounts = async () => {
      const actualPageCounts = await fetchActualPageCounts();

      if (Object.keys(actualPageCounts).length > 0) {
        const updatedConfigs = documentConfigs.map((config) => {
          const actualPages = actualPageCounts[config.type];
          if (actualPages && !config.avgPages) {
            return { ...config, avgPages: actualPages };
          }
          return config;
        });

        setDocumentConfigs(updatedConfigs);
      }
    };

    // Run once on component mount
    populatePageCounts();
  }, []); // Remove documents dependency

  const [documentConfigs, setDocumentConfigs] = useState([
    {
      type: '',
      avgPages: '',
      ocrTokens: '',
      classificationTokens: '',
      extractionTokens: '',
      summarizationTokens: '',
      assessmentTokens: '',
    },
  ]);

  const [configurationError, setConfigurationError] = useState(null);

  const [processingConfig, setProcessingConfig] = useState(() => {
    const defaultMaxLatency = import.meta.env.VITE_DEFAULT_MAX_LATENCY;
    if (!defaultMaxLatency) {
      return {
        timeSlots: [{ hour: '9', documentType: '', docsPerHour: '' }],
        maxLatency: '7', // Temporary fallback for initialization
        missingConfig: 'VITE_DEFAULT_MAX_LATENCY',
      };
    }
    return {
      timeSlots: [{ hour: '9', documentType: '', docsPerHour: '' }], // Start with 9 AM
      maxLatency: defaultMaxLatency,
    };
  });

  const [loading, setLoading] = useState(false);
  const [hasCalculated, setHasCalculated] = useState(false);
  const [results, setResults] = useState(null);
  const [recentDocuments, setRecentDocuments] = useState([]);
  const [showDocumentPicker, setShowDocumentPicker] = useState(false);
  const [selectedDocuments, setSelectedDocuments] = useState([]);

  // Helper function to extract token and request values from metering data structure
  const extractTokensAndRequestsFromMetering = (meteringData) => {
    // Calculate estimated request count based on token usage patterns
    // Large token counts typically indicate multiple API requests due to chunking
    const estimateRequestsFromTokens = (tokens, stepType) => {
      if (!tokens || tokens === 0) return 0;

      // Get max tokens per request from environment or use defaults
      const maxTokensConfig = import.meta.env.VITE_MAX_TOKENS_PER_REQUEST;
      let maxTokensPerRequest;

      if (maxTokensConfig) {
        try {
          const config = JSON.parse(maxTokensConfig);
          maxTokensPerRequest = config[stepType] || config.default || parseInt(import.meta.env.VITE_DEFAULT_MAX_TOKENS_PER_REQUEST, 10);
        } catch (e) {
          maxTokensPerRequest = parseInt(import.meta.env.VITE_DEFAULT_MAX_TOKENS_PER_REQUEST, 10);
        }
      } else {
        // Get default max tokens per request by step type from environment - required for capacity planning
        const defaultTokensConfig = import.meta.env.VITE_DEFAULT_TOKENS_BY_STEP;
        if (!defaultTokensConfig) {
          console.warn('VITE_DEFAULT_TOKENS_BY_STEP environment variable is not configured');
          return 1; // Return minimal value when config missing
        }

        let defaults;
        try {
          defaults = JSON.parse(defaultTokensConfig);
        } catch (e) {
          console.error('VITE_DEFAULT_TOKENS_BY_STEP contains invalid JSON');
          return 1;
        }

        maxTokensPerRequest = defaults[stepType];
        if (!maxTokensPerRequest) {
          const defaultMaxTokens = import.meta.env.VITE_DEFAULT_MAX_TOKENS_PER_REQUEST;
          if (!defaultMaxTokens) {
            console.warn(`No token configuration found for step type: ${stepType}`);
            return 1;
          }
          maxTokensPerRequest = parseInt(defaultMaxTokens, 10);
        }
      }

      // Estimate requests based on token chunking
      return Math.max(1, Math.ceil(tokens / maxTokensPerRequest));
    };

    const data = {
      ocrTokens: 0,
      classificationTokens: 0,
      extractionTokens: 0,
      assessmentTokens: 0,
      summarizationTokens: 0,
      ocrRequests: 0,
      classificationRequests: 0,
      extractionRequests: 0,
      assessmentRequests: 0,
      summarizationRequests: 0,
    };

    // Extract tokens and estimate requests from context-prefixed keys
    Object.entries(meteringData).forEach(([key, metrics]) => {
      if (typeof metrics === 'object' && metrics !== null) {
        if (key.startsWith('OCR/')) {
          const tokenCount = metrics.totalTokens || (metrics.inputTokens || 0) + (metrics.outputTokens || 0);
          data.ocrTokens += Number(tokenCount) || 0;
          data.ocrRequests += estimateRequestsFromTokens(tokenCount, 'OCR');
        } else if (key.startsWith('Classification/')) {
          const tokenCount = metrics.totalTokens || (metrics.inputTokens || 0) + (metrics.outputTokens || 0);
          data.classificationTokens += Number(tokenCount) || 0;
          data.classificationRequests += estimateRequestsFromTokens(tokenCount, 'Classification');
        } else if (key.startsWith('Extraction/')) {
          const tokenCount = metrics.totalTokens || (metrics.inputTokens || 0) + (metrics.outputTokens || 0);
          data.extractionTokens += Number(tokenCount) || 0;
          data.extractionRequests += estimateRequestsFromTokens(tokenCount, 'Extraction');
        } else if (key.startsWith('Assessment/') || key.startsWith('GranularAssessment/')) {
          const tokenCount = metrics.totalTokens || (metrics.inputTokens || 0) + (metrics.outputTokens || 0);
          data.assessmentTokens += Number(tokenCount) || 0;
          data.assessmentRequests += estimateRequestsFromTokens(tokenCount, 'Assessment');
        } else if (key.startsWith('Summarization/')) {
          const tokenCount = metrics.totalTokens || (metrics.inputTokens || 0) + (metrics.outputTokens || 0);
          data.summarizationTokens += Number(tokenCount) || 0;
          data.summarizationRequests += estimateRequestsFromTokens(tokenCount, 'Summarization');
        } else if (key.startsWith('BDAProject/bda/') && metrics.pages) {
          const pages = Number(metrics.pages) || 0;
          const tokensPerPageConfig = import.meta.env.VITE_BDA_TOKENS_PER_PAGE;
          if (!tokensPerPageConfig) {
            console.warn('VITE_BDA_TOKENS_PER_PAGE environment variable is not configured for BDA pattern');
            return; // Skip this entry in forEach
          }
          const estimatedTokensPerPage = parseInt(tokensPerPageConfig, 10);
          if (Number.isNaN(estimatedTokensPerPage)) {
            console.error('VITE_BDA_TOKENS_PER_PAGE must be a valid number');
            return; // Skip this entry in forEach
          }
          const totalTokens = pages * estimatedTokensPerPage;
          data.summarizationTokens += totalTokens;
          data.summarizationRequests += estimateRequestsFromTokens(totalTokens, 'Summarization');
        }
      }
    });

    return data;
  };

  const fetchRecentDocuments = async () => {
    console.log('fetchRecentDocuments called');
    console.log('documents:', documents);

    try {
      if (!documents || documents.length === 0) {
        alert('No documents available. Please visit the Documents tab first to load document data, then return to Capacity Planning.');
        return;
      }

      console.log('Total documents:', documents.length);
      console.log('Sample document:', documents[0]);
      console.log('Sample document keys:', Object.keys(documents[0]));
      console.log('Sample document Metering:', documents[0].Metering);
      console.log('Sample document ObjectStatus:', documents[0].ObjectStatus);

      // Check different document statuses
      const completedDocs = documents.filter((doc) => doc.ObjectStatus === 'COMPLETED');
      const docsWithMetering = documents.filter((doc) => doc.Metering);
      const completedWithMetering = documents.filter((doc) => doc.ObjectStatus === 'COMPLETED' && doc.Metering);

      console.log('Completed documents:', completedDocs.length);
      console.log('Documents with metering:', docsWithMetering.length);
      console.log('Completed with metering:', completedWithMetering.length);

      // Log first completed document details
      if (completedDocs.length > 0) {
        console.log('First completed document:', completedDocs[0]);
        console.log('First completed document Metering field:', completedDocs[0].Metering);
      }

      // Try to find any documents with metering data, regardless of status
      let candidateDocuments = completedWithMetering;

      // If no completed documents with metering, try any documents with metering
      if (candidateDocuments.length === 0) {
        candidateDocuments = docsWithMetering;
        console.log('No completed documents with metering, trying any documents with metering');
      }

      // If still no documents, show detailed error
      if (candidateDocuments.length === 0) {
        const statusCounts = {};
        documents.forEach((doc) => {
          statusCounts[doc.ObjectStatus] = (statusCounts[doc.ObjectStatus] || 0) + 1;
        });

        alert(
          `No documents with metering data found.\n\n` +
            `Document status breakdown:\n${Object.entries(statusCounts)
              .map(([status, count]) => `${status}: ${count}`)
              .join('\n')}\n\n` +
            `Documents may be missing metering information. Check the browser console for detailed document structure.`,
        );
        return;
      }

      // Map documents with metering data
      const validDocuments = candidateDocuments
        .map((doc) => {
          let meteringData = {};
          try {
            meteringData = typeof doc.Metering === 'string' ? JSON.parse(doc.Metering) : doc.Metering;
          } catch (e) {
            console.warn('Failed to parse metering data for', doc.ObjectKey);
            return null;
          }

          // Extract token and request values from the metering data structure
          const extractedData = extractTokensAndRequestsFromMetering(meteringData);
          console.log('Extracted data for', doc.ObjectKey, ':', extractedData);

          return {
            ObjectKey: doc.ObjectKey,
            documentClass:
              doc.ObjectKey.split('.')[0].split(' - ')[0].replace(/_/g, '-') || doc.DocumentClass || doc.Sections?.[0]?.Class || 'Unknown',
            InitialEventTime: doc.InitialEventTime,
            ObjectStatus: doc.ObjectStatus,
            metering: extractedData,
          };
        })
        .filter((doc) => doc !== null)
        .slice(0, 20);

      console.log('Valid documents found:', validDocuments.length);
      setRecentDocuments(validDocuments);
      setSelectedDocuments([]);
      setShowDocumentPicker(true);
    } catch (error) {
      console.error('Error processing documents:', error);
      alert('Failed to process document data. Please try again.');
    }
  };

  const populateTokensFromDocument = (selectedDoc) => {
    if (!selectedDoc.metering) return;

    const docType = selectedDoc.documentClass || selectedDoc.ObjectKey.split('.')[0].replace(/_/g, '-');
    const metering = selectedDoc.metering;

    // Find existing config for this document type or create new one
    const existingIndex = documentConfigs.findIndex((config) => config.type === docType);

    const newConfig = {
      type: docType,
      avgPages: '', // Will be calculated from actual documents
      ocrTokens: metering.ocrTokens !== undefined ? metering.ocrTokens : '',
      classificationTokens: metering.classificationTokens !== undefined ? metering.classificationTokens : '',
      extractionTokens: metering.extractionTokens !== undefined ? metering.extractionTokens : '',
      assessmentTokens: metering.assessmentTokens !== undefined ? metering.assessmentTokens : '',
      summarizationTokens: metering.summarizationTokens !== undefined ? metering.summarizationTokens : '',
      ocrRequests: metering.ocrRequests !== undefined ? metering.ocrRequests : '',
      classificationRequests: metering.classificationRequests !== undefined ? metering.classificationRequests : '',
      extractionRequests: metering.extractionRequests !== undefined ? metering.extractionRequests : '',
      assessmentRequests: metering.assessmentRequests !== undefined ? metering.assessmentRequests : '',
      summarizationRequests: metering.summarizationRequests !== undefined ? metering.summarizationRequests : '',
    };

    let updatedConfigs;
    if (existingIndex >= 0) {
      // Update existing config
      updatedConfigs = [...documentConfigs];
      updatedConfigs[existingIndex] = { ...updatedConfigs[existingIndex], ...newConfig };
    } else {
      // Add new config
      updatedConfigs = [...documentConfigs, newConfig];
    }

    // Remove empty document configurations (those with no type or all empty token values)
    const filteredConfigs = updatedConfigs.filter((config) => {
      const hasType = config.type && config.type.trim() !== '';
      const hasTokens =
        config.ocrTokens || config.classificationTokens || config.extractionTokens || config.assessmentTokens || config.summarizationTokens;
      return hasType && hasTokens;
    });

    setDocumentConfigs(filteredConfigs);
    setShowDocumentPicker(false);
    setSelectedDocuments([]);
    alert(`Token usage populated for ${docType} from document: ${selectedDoc.ObjectKey}`);
  };

  const populateTokensFromMultipleDocuments = () => {
    if (selectedDocuments.length === 0) return;

    let updatedConfigs = [...documentConfigs];

    selectedDocuments.forEach((selectedDoc) => {
      if (!selectedDoc.metering) return;

      const docType = selectedDoc.documentClass || selectedDoc.ObjectKey.split('.')[0].replace(/_/g, '-');
      const metering = selectedDoc.metering;

      const existingIndex = updatedConfigs.findIndex((config) => config.type === docType);

      const newConfig = {
        type: docType,
        avgPages: metering.avgPages || '', // Use actual page count from metering
        ocrTokens: metering.ocrTokens !== undefined ? metering.ocrTokens : '',
        classificationTokens: metering.classificationTokens !== undefined ? metering.classificationTokens : '',
        extractionTokens: metering.extractionTokens !== undefined ? metering.extractionTokens : '',
        assessmentTokens: metering.assessmentTokens !== undefined ? metering.assessmentTokens : '',
        summarizationTokens: metering.summarizationTokens !== undefined ? metering.summarizationTokens : '',
        ocrRequests: metering.ocrRequests !== undefined ? metering.ocrRequests : '',
        classificationRequests: metering.classificationRequests !== undefined ? metering.classificationRequests : '',
        extractionRequests: metering.extractionRequests !== undefined ? metering.extractionRequests : '',
        assessmentRequests: metering.assessmentRequests !== undefined ? metering.assessmentRequests : '',
        summarizationRequests: metering.summarizationRequests !== undefined ? metering.summarizationRequests : '',
      };

      if (existingIndex >= 0) {
        updatedConfigs[existingIndex] = { ...updatedConfigs[existingIndex], ...newConfig };
      } else {
        updatedConfigs = [...updatedConfigs, newConfig];
      }
    });

    const filteredConfigs = updatedConfigs.filter((config) => {
      const hasType = config.type && config.type.trim() !== '';
      const hasTokens =
        config.ocrTokens || config.classificationTokens || config.extractionTokens || config.assessmentTokens || config.summarizationTokens;
      return hasType && hasTokens;
    });

    setDocumentConfigs(filteredConfigs);
    setShowDocumentPicker(false);
    setSelectedDocuments([]);
    alert(`Token usage populated for ${selectedDocuments.length} documents`);
  };

  const handleDocumentSelection = (document, isSelected) => {
    if (isSelected) {
      setSelectedDocuments([...selectedDocuments, document]);
    } else {
      setSelectedDocuments(selectedDocuments.filter((doc) => doc.ObjectKey !== document.ObjectKey));
    }
  };

  // Helper function to get readable model display name
  const getModelDisplayName = (modelId) => {
    if (!modelId) return 'Not configured';

    // Extract readable name from model ID
    let displayName = modelId;

    // Remove region prefix (e.g., "us.amazon.nova-lite-v1:0" -> "amazon.nova-lite-v1:0")
    if (displayName.includes('.')) {
      const parts = displayName.split('.');
      if (parts.length > 2) {
        displayName = parts.slice(1).join('.');
      }
    }

    // Remove version suffix (e.g., "amazon.nova-lite-v1:0" -> "amazon.nova-lite-v1")
    if (displayName.includes(':')) {
      displayName = displayName.split(':')[0];
    }

    // Clean up common prefixes
    displayName = displayName.replace(/^amazon\./, '').replace(/^anthropic\./, '');

    return displayName;
  };

  const timeSlotOptions = Array.from({ length: 24 }, (_, i) => {
    const currentHour = String(i).padStart(2, '0');
    const nextHour = String((i + 1) % 24).padStart(2, '0');
    return {
      label: `${currentHour}:00 - ${nextHour}:00`,
      value: String(i),
    };
  });

  const documentTypeOptions = useMemo(() => {
    const defaultOption = { label: '-- Select Document Type --', value: '', disabled: true };

    // Get document types from configuration classes
    let classOptions = [];
    if (configuration?.classes && Array.isArray(configuration.classes)) {
      classOptions = configuration.classes
        .map((docClass) => {
          // Handle both legacy format and JSON Schema format
          let documentTypeName;
          let description;

          if (docClass['x-aws-idp-document-type']) {
            // JSON Schema format - use x-aws-idp-document-type for the document type name
            documentTypeName = docClass['x-aws-idp-document-type'];
            description = docClass.description || `${documentTypeName} document processing`;
          } else if (docClass.name) {
            // Legacy format - use name field
            documentTypeName = docClass.name;
            description = docClass.description || `${documentTypeName} document processing`;
          } else if (docClass.$id) {
            // JSON Schema format fallback - use $id if x-aws-idp-document-type is missing
            documentTypeName = docClass.$id;
            description = docClass.description || `${documentTypeName} document processing`;
          } else {
            // Unknown format - skip this class
            return null;
          }

          return {
            label: documentTypeName,
            value: documentTypeName,
            description,
          };
        })
        .filter(Boolean); // Remove null entries
    }

    // Add custom document types from documentConfigs
    const customOptions = documentConfigs
      .filter((config) => config.type && config.type !== '')
      .map((config) => ({
        label: config.type,
        value: config.type,
        description: `Custom document type: ${config.type}`,
      }))
      .filter((customOption) => !classOptions.some((classOption) => classOption.value === customOption.value));

    // Add processed document types from documents context
    const processedOptions = [];
    if (documents && Array.isArray(documents)) {
      const processedTypes = new Set();
      documents.forEach((doc) => {
        if (doc.ObjectStatus === 'COMPLETED') {
          const docType = doc.ObjectKey.split('.')[0].split(' - ')[0].replace(/_/g, '-') || doc.DocumentClass || doc.Sections?.[0]?.Class;
          if (docType && docType !== 'Unknown') {
            processedTypes.add(docType);
          }
        }
      });

      processedTypes.forEach((docType) => {
        if (!classOptions.some((opt) => opt.value === docType) && !customOptions.some((opt) => opt.value === docType)) {
          processedOptions.push({
            label: docType,
            value: docType,
            description: `Processed document type: ${docType}`,
          });
        }
      });
    }

    return [defaultOption, ...classOptions, ...customOptions, ...processedOptions];
  }, [configuration, documentConfigs, documents]);

  // Processing Schedule should only show configured document types
  const scheduleDocumentTypeOptions = useMemo(() => {
    const defaultOption = { label: '-- Select Document Type --', value: '', disabled: true };

    // Only include document types that have been configured in Document Processing
    const configuredOptions = documentConfigs
      .filter((config) => config.type && config.type !== '')
      .map((config) => ({
        label: config.type,
        value: config.type,
        description: `Configure processing schedule for ${config.type}`,
      }));

    if (configuredOptions.length === 0) {
      return [
        defaultOption,
        {
          label: 'No document types configured',
          value: '',
          disabled: true,
          description: 'Add document types in Document Processing section first',
        },
      ];
    }

    return [defaultOption, ...configuredOptions];
  }, [documentConfigs]);

  const getDeployedPattern = () => {
    // Manual override takes precedence over everything
    if (manualPattern) {
      return manualPattern;
    }

    // Use the same logic as the left panel - simple and reliable
    if (deploymentSettings?.IDPPattern) {
      const pattern = deploymentSettings.IDPPattern.split(' ')[0]; // Extract just "Pattern1", "Pattern2", etc.

      if (pattern === 'Pattern1') {
        return 'PATTERN-1';
      }
      if (pattern === 'Pattern3') {
        return 'PATTERN-3';
      }
      if (pattern === 'Pattern2') {
        return 'PATTERN-2';
      }
    }

    // If data is still loading, return loading state
    if (!deploymentSettings) {
      return 'LOADING...';
    }

    // No fallback - require explicit pattern configuration
    return 'CONFIGURATION_REQUIRED';
  };

  // Initialize tokensPerDoc when component mounts or pattern changes
  // Removed automatic recalculation to keep tokens fully editable

  // Effect to refresh when configuration changes
  useEffect(() => {
    // Clear previous results when configuration changes to force recalculation
    if (configuration) {
      setResults(null);
      setHasCalculated(false);
    }
  }, [configuration]);

  const updateDocumentConfig = async (index, field, value) => {
    const updated = [...documentConfigs];
    updated[index][field] = value;

    setDocumentConfigs(updated);
  };

  const removeDocumentConfig = (index) => {
    const updated = documentConfigs.filter((_, i) => i !== index);
    setDocumentConfigs(updated);
  };

  const addTimeSlot = () => {
    const updated = { ...processingConfig };
    updated.timeSlots.push({ hour: '9', documentType: '', docsPerHour: '' }); // Start empty
    setProcessingConfig(updated);
  };

  const updateTimeSlot = (index, field, value) => {
    const updated = { ...processingConfig };
    updated.timeSlots[index][field] = value;
    setProcessingConfig(updated);
  };

  const removeTimeSlot = (index) => {
    const updated = { ...processingConfig };
    updated.timeSlots = updated.timeSlots.filter((_, i) => i !== index);
    setProcessingConfig(updated);
  };

  const calculateCapacityRequirements = async () => {
    setLoading(true);
    setHasCalculated(false);
    try {
      // Fetch the latest configuration before calculating
      await fetchConfiguration();

      // Validate OCR tokens if Bedrock OCR is configured
      if (configuration?.ocr?.backend === 'bedrock') {
        const hasDocumentsWithMissingOcrTokens = documentConfigs.some(
          (config) => !config.ocrTokens || config.ocrTokens === '' || Number.isNaN(parseFloat(config.ocrTokens)),
        );

        if (hasDocumentsWithMissingOcrTokens) {
          setResults({
            success: false,
            errorMessage:
              'OCR tokens are required for all document types when Bedrock OCR is configured. ' +
              'Please specify OCR token values in the Document Processing section.',
            metrics: [{ label: 'Validation Error', value: 'Missing OCR Tokens' }],
            quotaRequirements: [],
          });
          setHasCalculated(true);
          setLoading(false);
          return;
        }
      }

      // Calculate total docs per hour from processing schedule time slots
      const totalDocsPerHour = processingConfig.timeSlots.reduce(
        (sum, slot) => sum + parseInt(slot.docsPerHour || 0, 10), // Default to 0 if empty
        0,
      );

      // Aggregate document configs from processing schedule
      const aggregatedDocConfigs = {};
      processingConfig.timeSlots
        .filter((slot) => slot)
        .forEach((slot) => {
          const docType = slot.documentType || 'Other'; // Default to 'Other' if no type selected
          const docsPerHour = parseInt(slot.docsPerHour || 0, 10); // Default to 0 if empty

          if (!aggregatedDocConfigs[docType]) {
            // Find the document config for this type
            const docConfig = documentConfigs.find((config) => config.type === docType) || {
              type: docType,
              avgPages: '', // No default - must be calculated from actual documents
              ocrTokens: '',
              classificationTokens: '',
              extractionTokens: '',
              summarizationTokens: '',
              assessmentTokens: '',
            };

            aggregatedDocConfigs[docType] = {
              type: docType,
              avgPages: parseFloat(docConfig.avgPages) || 0, // Use actual pages, 0 if not available
              ocrTokens: parseFloat(docConfig.ocrTokens || 0),
              classificationTokens: parseFloat(docConfig.classificationTokens || 0),
              extractionTokens: parseFloat(docConfig.extractionTokens || 0),
              summarizationTokens: parseFloat(docConfig.summarizationTokens || 0),
              assessmentTokens: parseFloat(docConfig.assessmentTokens || 0),
              docsPerHour,
            };
          } else {
            // Add to existing aggregation
            aggregatedDocConfigs[docType].docsPerHour += docsPerHour;
          }
        });

      // Convert aggregated configs to array format expected by API
      const documentConfigsForAPI = Object.values(aggregatedDocConfigs);

      // Get dynamic model configuration from deployment settings and configuration
      const modelConfig = {
        extraction_model: configuration?.extraction?.model,
        classification_model: configuration?.classification?.model,
        assessment_model: configuration?.assessment?.model,
        summarization_model: configuration?.summarization?.model,
        ocr_model: configuration?.ocr?.model_id,
      };

      // Add request count data to document configs for API
      const documentConfigsWithRequests = documentConfigsForAPI.map((config) => ({
        ...config,
        // Add request counts if available from metering data
        ocrRequests: config.ocrRequests || 1,
        classificationRequests: config.classificationRequests || 1,
        extractionRequests: config.extractionRequests || 1,
        assessmentRequests: config.assessmentRequests || 1,
        summarizationRequests: config.summarizationRequests || 1,
      }));

      const input = {
        documentConfigs: documentConfigsWithRequests,
        maxAllowedLatency: parseFloat(processingConfig.maxLatency),
        totalDocsPerHour,
        userConfig: JSON.stringify(modelConfig),
        pattern: getDeployedPattern(),
        timeSlots: JSON.stringify(processingConfig.timeSlots),
      };

      // Validate input before sending
      if (!input.documentConfigs || input.documentConfigs.length === 0) {
        throw new Error('No document configurations provided');
      }

      if (!input.pattern || input.pattern === 'LOADING...') {
        throw new Error('Pattern not loaded yet, please wait and try again');
      }

      if (!input.timeSlots || input.timeSlots === '[]') {
        throw new Error('No processing schedule configured');
      }

      // Always ensure we show the UI components - remove validation blocks that prevent rendering
      // Set hasCalculated to true FIRST so UI shows regardless of validation
      setHasCalculated(true);

      // Validate input but continue processing even with warnings
      if (!input.pattern || input.pattern === 'LOADING...') {
        setResults({
          success: false,
          errorMessage: 'Pattern not detected. Please ensure deployment is complete.',
          metrics: [
            { label: 'Total Docs', value: '0' },
            { label: 'Total Pages', value: '0' },
            { label: 'Total Tokens', value: '0M' },
          ],
          quotaRequirements: [],
        });
        setLoading(false);
        return;
      }

      if (!input.documentConfigs || input.documentConfigs.length === 0) {
        setResults({
          success: false,
          errorMessage: 'No document configurations provided. Please add at least one document type.',
          metrics: [
            { label: 'Total Docs', value: '0' },
            { label: 'Total Pages', value: '0' },
            { label: 'Total Tokens', value: '0M' },
          ],
          quotaRequirements: [],
        });
        setLoading(false);
        return;
      }

      if (input.totalDocsPerHour === 0) {
        setResults({
          success: false,
          errorMessage: 'Total documents per hour is 0. Please specify processing volume in the schedule.',
          metrics: [
            { label: 'Total Docs', value: '0' },
            { label: 'Total Pages', value: '0' },
            { label: 'Total Tokens', value: '0M' },
          ],
          quotaRequirements: [],
        });
        setLoading(false);
        return;
      }

      console.log('🔍 Sending capacity calculation request:', input);

      const response = await client.graphql({
        query: `
          query CalculateCapacity($input: String!) {
            calculateCapacity(input: $input) {
              success
              errorMessage
              metrics {
                label
                value
              }
              quotaRequirements {
                service
                category
                currentQuota
                requiredQuota
                statusText
                modelId
              }
              latencyDistribution {
                p50
                p75
                p90
                p95
                p99
                baseLatency
                queueLatency
                totalLatency
                exceedsLimit
                maxAllowed
              }
              calculationDetails {
                quotasUsed {
                  bedrock_models
                }
              }
              recommendations
            }
          }
        `,
        variables: { input: JSON.stringify(input) },
      });

      console.log('📊 Capacity calculation response:', response);

      if (response.data?.calculateCapacity) {
        // The response now has the proper GraphQL structure
        const result = response.data.calculateCapacity;

        console.log('✅ API result:', result);

        // Check if API returned success
        if (result.success) {
          setResults(result);
          setHasCalculated(true);
          return; // Exit early on success
        }
        // API returned structured error
        throw new Error(result.errorMessage || 'API returned unsuccessful result');
      } else {
        throw new Error(`No data returned from API. Response: ${JSON.stringify(response.data || response)}`);
      }
    } catch (error) {
      console.error('❌ Capacity calculation error:', error);

      // Log GraphQL errors specifically
      if (error.errors) {
        error.errors.forEach((gqlError, index) => {
          console.error(`GraphQL Error ${index + 1}:`, gqlError);
        });
      }

      // Show more specific error message to user
      let errorMessage = 'Capacity calculation service is temporarily unavailable.';
      if (error.message && error.message.includes('No data returned from API')) {
        errorMessage = 'The capacity calculation API returned an unexpected response format.';
      } else if (error.message && error.message.includes('API Error:')) {
        errorMessage = error.message; // Show the actual API error
      } else if (error.errors && error.errors.length > 0) {
        errorMessage = `API Error: ${error.errors[0].message}`;
      }

      setResults({
        success: false,
        errorMessage: errorMessage,
        metrics: [],
        quotaRequirements: [],
      });
      setHasCalculated(true);
    } finally {
      setLoading(false);
      // Ensure hasCalculated is ALWAYS set to true when calculation completes
      setHasCalculated(true);
    }
  };

  // Memoized capacity calculations that update when config changes
  const capacityMetrics = useMemo(() => {
    // Helper function to safely parse numbers
    const safeParseInt = (value, defaultValue = 0) => {
      const parsed = parseInt(value, 10);
      return Number.isNaN(parsed) ? defaultValue : parsed;
    };

    const safeParseFloat = (value, defaultValue = 0) => {
      const parsed = parseFloat(value);
      return Number.isNaN(parsed) ? defaultValue : parsed;
    };

    // Calculate totals from processing schedule
    const totalDocsPerHour = processingConfig.timeSlots.reduce((sum, slot) => {
      return sum + safeParseInt(slot.docsPerHour, 0);
    }, 0);

    // Calculate aggregated values from processing schedule
    let totalPagesPerHour = 0;
    let totalTokensPerHour = 0;

    processingConfig.timeSlots
      .filter((slot) => slot)
      .forEach((slot) => {
        const docType = slot.documentType || 'Other';
        const docsPerHour = safeParseInt(slot.docsPerHour, 0);

        const docConfig = documentConfigs.find((config) => config.type === docType) || {
          avgPages: '', // No default - must be calculated from actual documents
          classificationTokens: 0,
          extractionTokens: 0,
          summarizationTokens: 0,
          assessmentTokens: 0,
        };

        const pages = safeParseFloat(docConfig.avgPages, 0); // Use actual pages, 0 if not available
        const ocrTokens = safeParseFloat(docConfig.ocrTokens, 0);
        const classificationTokens = safeParseFloat(docConfig.classificationTokens, 0);
        const extractionTokens = safeParseFloat(docConfig.extractionTokens, 0);
        const summarizationTokens = safeParseFloat(docConfig.summarizationTokens, 0);
        const assessmentTokens = safeParseFloat(docConfig.assessmentTokens, 0);
        const totalDocTokens = ocrTokens + classificationTokens + extractionTokens + summarizationTokens + assessmentTokens;

        totalPagesPerHour += docsPerHour * pages;
        totalTokensPerHour += docsPerHour * totalDocTokens;
      });

    const safeTokensPerHour = Number.isNaN(totalTokensPerHour) ? 0 : totalTokensPerHour;

    // Use API response data if available and calculation has been performed
    if (results?.success && results?.metrics && hasCalculated) {
      return results.metrics.map((metric) => ({
        ...metric,
        // Ensure values are properly formatted
        value: metric.value || '0',
      }));
    }

    // Show calculated values or placeholders
    if (hasCalculated && results?.success === false) {
      // No cost calculation
    } else if (hasCalculated) {
      // No cost calculation
    }

    return [
      {
        label: 'Total Docs',
        value: totalDocsPerHour > 0 ? totalDocsPerHour.toString() : '0',
      },
      {
        label: 'Total Pages',
        value: totalPagesPerHour > 0 ? Math.round(totalPagesPerHour).toString() : '0',
      },
      {
        label: 'Total Tokens',
        value: safeTokensPerHour > 0 ? `${(safeTokensPerHour / 1000000).toFixed(2)}M` : '0M',
      },
    ];
  }, [documentConfigs, processingConfig, results, hasCalculated]);

  // Memoized quota data that updates when config changes
  const quotaData = useMemo(() => {
    // Use API response data if available - check for successful calculation
    if (results?.success && hasCalculated) {
      // Check for quotaRequirements array in the GraphQL response
      if (results.quotaRequirements && Array.isArray(results.quotaRequirements) && results.quotaRequirements.length > 0) {
        // Process the quota requirements to ensure proper display
        return results.quotaRequirements.map((quota) => {
          // Process service name to show full model IDs
          let displayService = quota.service;
          if (quota.modelId) {
            const stepMatch = quota.service.match(/\(([^)]+)\)$/);
            const stepName = stepMatch ? stepMatch[1] : quota.usedFor || '';
            displayService = stepName ? `${quota.modelId} (${stepName})` : quota.modelId;
          }

          return {
            ...quota,
            service: displayService,
            category: quota.category || 'Bedrock Models',
          };
        });
      }

      // Enhanced debugging for empty quota requirements
      if (results.quotaRequirements && Array.isArray(results.quotaRequirements) && results.quotaRequirements.length === 0) {
      }

      // Fallback: build quota data from configuration if no quotaRequirements
      const quotaList = [];

      // Get the models from configuration including OCR
      const models = [];

      // Add OCR model first if configured for document processing
      const hasOcrTokens = documentConfigs.some((config) => config.ocrTokens && parseFloat(config.ocrTokens) > 0);
      if (hasOcrTokens && configuration?.ocr?.backend === 'bedrock') {
        const ocrModelId = configuration?.ocr?.model_id || configuration?.ocr?.model || 'us.amazon.nova-lite-v1:0';
        models.push({ id: ocrModelId, step: 'OCR' });
      }

      // Add other models
      [
        { id: configuration?.classification?.model, step: 'Classification' },
        { id: configuration?.extraction?.model, step: 'Extraction' },
        { id: configuration?.assessment?.model, step: 'Assessment' },
        { id: configuration?.summarization?.model, step: 'Summarization' },
      ].forEach((model) => {
        if (model.id) models.push(model);
      });

      // Add quota values for each configured model - use only API data
      models.forEach(({ id: modelId, step }) => {
        const displayName = getModelDisplayName(modelId);

        // Calculate required quota for this specific inference step
        let peakTokensPerMinute = 0;
        processingConfig.timeSlots.forEach((slot) => {
          const docsPerHour = parseInt(slot.docsPerHour || 0, 10);
          const docType = slot.documentType || '';

          if (docsPerHour > 0 && docType) {
            const docConfig = documentConfigs.find((config) => config.type === docType);
            if (docConfig) {
              let tokensPerDoc = 0;

              if (step === 'Classification') tokensPerDoc = parseFloat(docConfig.classificationTokens || 0);
              else if (step === 'Extraction') tokensPerDoc = parseFloat(docConfig.extractionTokens || 0);
              else if (step === 'Assessment') tokensPerDoc = parseFloat(docConfig.assessmentTokens || 0);
              else if (step === 'Summarization') tokensPerDoc = parseFloat(docConfig.summarizationTokens || 0);
              else if (step === 'OCR') tokensPerDoc = parseFloat(docConfig.ocrTokens || 0);

              const slotTokensPerMinute = (docsPerHour / 60) * tokensPerDoc;
              peakTokensPerMinute = Math.max(peakTokensPerMinute, slotTokensPerMinute);
            }
          }
        });

        const requiredQuota = Math.ceil(peakTokensPerMinute).toLocaleString();

        quotaList.push({
          service: `${modelId} (${step}) - TPM`,
          category: 'Bedrock Models',
          currentQuota: 'API Required',
          requiredQuota,
          statusText: '⚠️ Check AWS Console',
          modelId,
        });
      });

      return quotaList;
    }
    return [];
  }, [documentConfigs, processingConfig, configuration, results, manualPattern, deploymentSettings]);

  const groupQuotasByCategory = (quotas) => {
    const grouped = {};
    quotas.forEach((quota) => {
      const category = quota.category || 'Other Services';

      // Show ALL Bedrock models, not just classification
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(quota);
    });
    return grouped;
  };

  const exportCapacityPlan = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = prompt('Enter filename for export:', `capacity-plan-${getDeployedPattern()}-${timestamp}`);
    if (!filename) return;

    let csvContent = '';

    // Header information
    csvContent += 'Capacity Planning Export\n';
    csvContent += `Pattern: ${getDeployedPattern()}\n`;
    csvContent += `Export Date: ${new Date().toISOString()}\n`;
    csvContent += `Max Latency: ${processingConfig.maxLatency} minutes\n\n`;

    // Document configurations
    csvContent += 'Document Processing Configuration\n';
    csvContent += 'Document Type,Avg Pages,';
    if (configuration?.ocr?.backend === 'bedrock') csvContent += 'OCR Tokens,';
    csvContent += 'Classification Tokens,Extraction Tokens,Assessment Tokens,Summarization Tokens\n';

    documentConfigs.forEach((config) => {
      let row = `"${config.type}","${config.avgPages}",`;
      if (configuration?.ocr?.backend === 'bedrock') row += `"${config.ocrTokens || ''}",`;
      row += `"${config.classificationTokens || ''}","${config.extractionTokens || ''}","${config.assessmentTokens || ''}","${
        config.summarizationTokens || ''
      }"\n`;
      csvContent += row;
    });

    // Processing schedule
    csvContent += '\nProcessing Schedule\n';
    csvContent += 'Hour,Document Type,Docs Per Hour\n';
    processingConfig.timeSlots.forEach((slot) => {
      csvContent += `"${slot.hour}:00","${slot.documentType}","${slot.docsPerHour}"\n`;
    });

    // Capacity metrics
    if (hasCalculated) {
      csvContent += '\nCapacity Metrics\n';
      csvContent += 'Metric,Value\n';
      capacityMetrics.forEach((metric) => {
        csvContent += `"${metric.label}","${metric.value}"\n`;
      });
    }

    // Quota requirements
    if (quotaData.length > 0) {
      csvContent += '\nQuota Requirements\n';
      csvContent += 'Service,Category,Current Quota,Required Quota,Status\n';
      quotaData.forEach((quota) => {
        const row = [
          `"${quota.service}"`,
          `"${quota.category}"`,
          `"${quota.currentQuota}"`,
          `"${quota.requiredQuota}"`,
          `"${quota.statusText}"`,
        ].join(',');
        csvContent += `${row}\n`;
      });
    }

    // Model configuration
    csvContent += '\nModel Configuration\n';
    csvContent += 'Service,Model\n';
    if (configuration?.ocr?.backend === 'bedrock') csvContent += `"OCR","${configuration?.ocr?.model_id || 'Not configured'}"\n`;
    csvContent += `"Classification","${configuration?.classification?.model || 'Not configured'}"\n`;
    csvContent += `"Extraction","${configuration?.extraction?.model || 'Not configured'}"\n`;
    csvContent += `"Assessment","${configuration?.assessment?.model || 'Not configured'}"\n`;
    csvContent += `"Summarization","${configuration?.summarization?.model || 'Not configured'}"\n`;

    const dataBlob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Container>
      <SpaceBetween size="l">
        {/* Header */}
        <Header
          variant="h1"
          actions={
            <Button variant="primary" iconName="download" onClick={exportCapacityPlan}>
              Export Capacity Plan
            </Button>
          }
        >
          Capacity Planning
          <Box variant="p">
            <Badge color="blue">{getDeployedPattern()}</Badge>
            {deploymentSettings?.IDPPattern && (
              <Box fontSize="body-s" color="text-body-secondary" marginTop="xs">
                Detected from deployment: {deploymentSettings.IDPPattern}
              </Box>
            )}
          </Box>
        </Header>

        {/* Configuration Status Alert */}
        {configuration && (
          <Alert type="success">
            <strong>✓</strong> Using dynamic configuration values from View/Edit Configuration.
            <Box marginTop="xs">
              Token calculations and processing times are loaded from your pattern configuration. Update models in{' '}
              <strong>View/Edit Configuration</strong> to see changes reflected immediately.
            </Box>
            {deploymentSettings && (
              <Box marginTop="xs">
                <strong>Deployment Info:</strong> Stack {deploymentSettings.StackName} | Version {deploymentSettings.Version} | Built{' '}
                {deploymentSettings.BuildDateTime}
              </Box>
            )}
          </Alert>
        )}

        {!configuration && (
          <Alert type="warning">
            <strong>⚠️ Configuration not loaded.</strong> Please visit the <strong>View/Edit Configuration</strong> tab first to load your
            pattern configuration, then return to Capacity Planning.
          </Alert>
        )}

        {getDeployedPattern() === 'PATTERN-2' && !configuration?.classification?.model && !manualPattern && (
          <Alert type="warning">
            <strong>⚠️ Pattern Detection Used Fallback.</strong> Using Pattern 2 default. Configure models in{' '}
            <strong>View/Edit Configuration</strong> for accurate calculations.
            <Box marginTop="m">
              <strong>Manual Override Available:</strong> If you know your actual deployment pattern:
              <Box marginTop="xs">
                <SpaceBetween direction="horizontal" size="s">
                  <Button variant="normal" onClick={() => setManualPattern('PATTERN-1')}>
                    Pattern 1 (BDA)
                  </Button>
                  <Button variant="normal" onClick={() => setManualPattern('PATTERN-2')}>
                    Pattern 2 (Bedrock)
                  </Button>
                  <Button variant="normal" onClick={() => setManualPattern('PATTERN-3')}>
                    Pattern 3 (SageMaker)
                  </Button>
                </SpaceBetween>
              </Box>
            </Box>
          </Alert>
        )}

        {manualPattern && (
          <Alert type="warning">
            <strong>⚠️ Manual Pattern Override Active:</strong> Using manually selected {manualPattern}.
            <Button variant="link" onClick={() => setManualPattern(null)}>
              Reset to Automatic Detection
            </Button>
          </Alert>
        )}

        {/* Document Processing Configuration */}
        <Container header={<Header variant="h2">Document Processing</Header>}>
          <SpaceBetween size="m">
            <Alert type="info">
              <strong>Document Processing Configuration:</strong> Enter the expected number of tokens per document type for each processing
              step. These values represent the tokens used for classification, extraction, assessment, and summarization processing. Leave
              empty and calculate capacity to see actual usage from processed documents.
            </Alert>

            <Table
              columnDefinitions={[
                {
                  id: 'type',
                  header: (
                    <div style={{ fontSize: '0.85em', lineHeight: '1.2' }}>
                      <div>Document</div>
                      <div>Type</div>
                    </div>
                  ),
                  width: 120,
                  cell: (item) => (
                    <Select
                      selectedOption={documentTypeOptions.find((opt) => opt.value === item.type && !opt.disabled) || null}
                      onChange={({ detail }) => updateDocumentConfig(item.index, 'type', detail.selectedOption.value)}
                      options={documentTypeOptions}
                      placeholder="Select document type"
                      expandToViewport
                    />
                  ),
                },
                {
                  id: 'avgPages',
                  header: (
                    <div style={{ fontSize: '0.85em', lineHeight: '1.2' }}>
                      <div>Avg Pages/</div>
                      <div>Doc</div>
                    </div>
                  ),
                  width: 80,
                  cell: (item) => (
                    <div>
                      <Input
                        type="number"
                        value={item.avgPages}
                        onChange={({ detail }) => updateDocumentConfig(item.index, 'avgPages', detail.value)}
                        step={0.1}
                        placeholder="Process docs first"
                      />
                      {!item.avgPages && (
                        <div>
                          <div style={{ fontSize: '0.75em', color: '#d13212', marginTop: '2px' }}>Process documents to calculate</div>
                          <Button
                            variant="link"
                            onClick={async () => {
                              const actualPageCounts = await fetchActualPageCounts();
                              const actualPages = actualPageCounts[item.type];
                              if (actualPages) {
                                updateDocumentConfig(item.index, 'avgPages', actualPages);
                              } else {
                                console.log(`No page data found for document type: ${item.type}`);
                              }
                            }}
                            style={{ fontSize: '0.75em', padding: '2px 0' }}
                          >
                            Calculate from processed docs
                          </Button>
                        </div>
                      )}
                    </div>
                  ),
                },
                ...(configuration?.ocr?.backend === 'bedrock'
                  ? [
                      {
                        id: 'ocrTokens',
                        header: (
                          <div>
                            <div>OCR</div>
                            <div style={{ fontSize: '0.8em', color: '#2f3b4a', fontWeight: 'normal' }}>
                              Model: {configuration?.ocr?.model_id || 'Not configured'}
                            </div>
                          </div>
                        ),
                        cell: (item) => (
                          <Input
                            type="number"
                            value={item.ocrTokens || ''}
                            placeholder="OCR tokens"
                            onChange={({ detail }) => updateDocumentConfig(item.index, 'ocrTokens', parseFloat(detail.value) || '')}
                          />
                        ),
                      },
                    ]
                  : []),
                {
                  id: 'classificationTokens',
                  header: (
                    <div>
                      <div>Classification</div>
                      <div style={{ fontSize: '0.8em', color: '#2f3b4a', fontWeight: 'normal' }}>
                        Model: {configuration?.classification?.model || 'Not configured'}
                      </div>
                    </div>
                  ),
                  cell: (item) => (
                    <Input
                      type="number"
                      value={item.classificationTokens || ''}
                      placeholder="Classification tokens"
                      onChange={({ detail }) => updateDocumentConfig(item.index, 'classificationTokens', parseFloat(detail.value) || '')}
                    />
                  ),
                },
                {
                  id: 'extractionTokens',
                  header: (
                    <div>
                      <div>Extraction</div>
                      <div style={{ fontSize: '0.8em', color: '#2f3b4a', fontWeight: 'normal' }}>
                        Model: {configuration?.extraction?.model || 'Not configured'}
                      </div>
                    </div>
                  ),
                  cell: (item) => (
                    <Input
                      type="number"
                      value={item.extractionTokens || ''}
                      placeholder="Extraction tokens"
                      onChange={({ detail }) => updateDocumentConfig(item.index, 'extractionTokens', parseFloat(detail.value) || '')}
                    />
                  ),
                },
                {
                  id: 'assessmentTokens',
                  header: (
                    <div>
                      <div>Assessment</div>
                      <div style={{ fontSize: '0.8em', color: '#2f3b4a', fontWeight: 'normal' }}>
                        Model: {configuration?.assessment?.model || 'Not configured'}
                      </div>
                    </div>
                  ),
                  cell: (item) => (
                    <Input
                      type="number"
                      value={item.assessmentTokens || ''}
                      placeholder="Assessment tokens"
                      onChange={({ detail }) => updateDocumentConfig(item.index, 'assessmentTokens', parseFloat(detail.value) || '')}
                    />
                  ),
                },
                {
                  id: 'summarizationTokens',
                  header: (
                    <div>
                      <div>Summarization</div>
                      <div style={{ fontSize: '0.8em', color: '#2f3b4a', fontWeight: 'normal' }}>
                        Model: {configuration?.summarization?.model || 'Not configured'}
                      </div>
                    </div>
                  ),
                  cell: (item) => (
                    <Input
                      type="number"
                      value={item.summarizationTokens || ''}
                      placeholder="Summarization tokens"
                      onChange={({ detail }) => updateDocumentConfig(item.index, 'summarizationTokens', parseFloat(detail.value) || '')}
                    />
                  ),
                },
                {
                  id: 'actions',
                  header: '',
                  cell: (item) => (
                    <Button
                      variant="icon"
                      iconName="close"
                      onClick={() => removeDocumentConfig(item.index)}
                      ariaLabel="Remove document configuration"
                    />
                  ),
                },
              ]}
              items={documentConfigs.map((config, index) => ({ ...config, index }))}
              empty={<Box textAlign="center">No document configurations</Box>}
            />

            <SpaceBetween direction="horizontal" size="s">
              <Button
                variant="link"
                onClick={() => {
                  const newConfig = {
                    type: '',
                    avgPages: '', // No default - must be calculated from actual documents
                    ocrTokens: '',
                    classificationTokens: '',
                    extractionTokens: '',
                    summarizationTokens: '',
                    assessmentTokens: '',
                  };
                  setDocumentConfigs([...documentConfigs, newConfig]);
                }}
              >
                + Add Document Type
              </Button>

              <Button variant="normal" iconName="refresh" onClick={fetchRecentDocuments}>
                Populate tokens from Documents
              </Button>
            </SpaceBetween>

            <Button
              variant="normal"
              iconName="upload"
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.csv';
                input.onchange = (e) => {
                  const file = e.target.files[0];
                  if (!file) return;

                  const reader = new FileReader();
                  reader.onload = (event) => {
                    try {
                      const csv = event.target.result;
                      const lines = csv.split('\n').filter((line) => line.trim());

                      if (lines.length < 2) {
                        alert('Error: CSV file must have at least a header row and one data row.');
                        return;
                      }

                      // Check CSV structure
                      const headerLine = lines[0];
                      const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
                      const sampleDataLine = lines[1];
                      const sampleValues = sampleDataLine.split(',').map((v) => v.trim());

                      // Check if OCR column exists by looking for 'ocr' in headers
                      const ocrColumnIndex = headers.findIndex((header) => header.includes('ocr'));
                      const hasValidOcrColumn = ocrColumnIndex !== -1;

                      // Check if OCR column is missing when Bedrock OCR is configured
                      const isBedrockOcrConfigured = configuration?.ocr?.backend === 'bedrock';

                      if (isBedrockOcrConfigured && !hasValidOcrColumn) {
                        alert(
                          'Error: OCR tokens column is missing from CSV file.\n\n' +
                            'When Bedrock OCR is configured, your CSV must include an "OCR" column.\n' +
                            'Expected columns: Document Type, Average Pages, OCR Tokens, ' +
                            'Classification Tokens, ...\n\n' +
                            'Please add the OCR tokens column to your CSV file.',
                        );
                        return;
                      }

                      const importedConfigs = [];

                      for (let i = 1; i < lines.length; i += 1) {
                        const values = lines[i].split(',').map((v) => v.trim());
                        if (values.length >= 2) {
                          // At least type and avgPages required
                          const config = {
                            type: values[0] || '',
                            avgPages: parseFloat(values[1]) || 0, // Use actual pages from CSV, 0 if not provided
                            ocrTokens: hasValidOcrColumn && values[ocrColumnIndex] ? values[ocrColumnIndex] : '',
                            classificationTokens: values[hasValidOcrColumn ? ocrColumnIndex + 1 : 2] || '',
                            extractionTokens: values[hasValidOcrColumn ? ocrColumnIndex + 2 : 3] || '',
                            assessmentTokens: values[hasValidOcrColumn ? ocrColumnIndex + 3 : 4] || '',
                            summarizationTokens: values[hasValidOcrColumn ? ocrColumnIndex + 4 : 5] || '',
                          };
                          importedConfigs.push(config);
                        }
                      }

                      // Additional validation for OCR tokens if Bedrock OCR is configured
                      if (isBedrockOcrConfigured && importedConfigs.length > 0) {
                        const missingOcrTokens = importedConfigs.some(
                          (config) => !config.ocrTokens || config.ocrTokens === '' || Number.isNaN(parseFloat(config.ocrTokens)),
                        );
                        if (missingOcrTokens) {
                          alert(
                            'Error: OCR tokens are required in CSV when Bedrock OCR is configured.\n\n' +
                              'Please ensure all rows have valid numeric OCR token values ' +
                              'in the third column of your CSV file.\n\n' +
                              'Example CSV format:\n' +
                              'Document Type,Avg Pages,OCR Tokens,Classification Tokens,...\n' +
                              'Invoice,2,1500,800,...',
                          );
                          return;
                        }
                      }

                      if (importedConfigs.length > 0) {
                        setDocumentConfigs(importedConfigs);
                        alert(`Imported ${importedConfigs.length} document configurations`);
                      }
                    } catch (error) {
                      alert('Error parsing CSV file. Please check format.');
                    }
                  };
                  reader.readAsText(file);
                };
                input.click();
              }}
            >
              Import CSV
            </Button>

            <Button
              variant="normal"
              iconName="download"
              onClick={() => {
                // Create CSV content for document configurations
                let csvContent =
                  'Document Type,Average Pages,OCR Tokens,Classification Tokens,Extraction Tokens,Assessment Tokens,Summarization Tokens\n';

                documentConfigs.forEach((config) => {
                  const row = [
                    `"${config.type || ''}"`,
                    `"${config.avgPages || ''}"`, // Export actual pages, empty if not calculated
                    `"${config.ocrTokens || ''}"`,
                    `"${config.classificationTokens || ''}"`,
                    `"${config.extractionTokens || ''}"`,
                    `"${config.assessmentTokens || ''}"`,
                    `"${config.summarizationTokens || ''}"`,
                  ].join(',');
                  csvContent += `${row}\n`;
                });

                const dataBlob = new Blob([csvContent], { type: 'text/csv' });
                const url = URL.createObjectURL(dataBlob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'document-configurations.csv';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
              }}
            >
              Export CSV
            </Button>
          </SpaceBetween>
        </Container>

        {/* Processing Schedule */}
        <Container header={<Header variant="h2">Processing Schedule</Header>}>
          <SpaceBetween size="m">
            <Alert type="info">
              <strong>Processing Schedule Configuration:</strong> Define your expected document processing load by hour. Enter the number of
              documents you expect to process per hour for each time slot and document type. Leave empty if no processing is expected during
              that time.
            </Alert>
            <Table
              columnDefinitions={[
                {
                  id: 'hour',
                  header: 'Processing Hours',
                  cell: (item) => (
                    <Select
                      selectedOption={item.hour ? timeSlotOptions.find((opt) => opt.value === item.hour) : null}
                      onChange={({ detail }) => updateTimeSlot(item.index, 'hour', detail.selectedOption.value)}
                      options={timeSlotOptions}
                      placeholder="Select processing hour"
                      expandToViewport
                    />
                  ),
                },
                {
                  id: 'documentType',
                  header: 'Document Type',
                  cell: (item) => (
                    <Select
                      selectedOption={
                        item.documentType && item.documentType !== ''
                          ? scheduleDocumentTypeOptions.find((opt) => opt.value === item.documentType && !opt.disabled)
                          : null
                      }
                      onChange={({ detail }) => updateTimeSlot(item.index, 'documentType', detail.selectedOption.value)}
                      options={scheduleDocumentTypeOptions}
                      placeholder="Select document type"
                      expandToViewport
                    />
                  ),
                },
                {
                  id: 'docsPerHour',
                  header: 'Docs/Hour',
                  cell: (item) => (
                    <Input
                      type="number"
                      value={item.docsPerHour || ''}
                      onChange={({ detail }) => updateTimeSlot(item.index, 'docsPerHour', detail.value)}
                      placeholder="Enter docs per hour"
                    />
                  ),
                },
                {
                  id: 'actions',
                  header: 'Actions',
                  cell: (item) => (
                    <Button
                      variant="icon"
                      iconName="close"
                      onClick={() => removeTimeSlot(item.index)}
                      disabled={processingConfig.timeSlots.length === 1}
                      ariaLabel="Remove time slot"
                    />
                  ),
                },
              ]}
              items={processingConfig.timeSlots.map((slot, index) => ({ ...slot, index }))}
              empty={
                <Box textAlign="center" color="text-status-info">
                  No active processing hours configured. Add time slots with Docs/Hour &gt; 0 to see them here.
                </Box>
              }
            />
            <Button variant="link" onClick={addTimeSlot}>
              + Add Time Slot
            </Button>

            <SpaceBetween direction="horizontal" size="s">
              <Button
                variant="normal"
                iconName="upload"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.csv';
                  input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (!file) return;

                    const reader = new FileReader();
                    reader.onload = (event) => {
                      try {
                        const csv = event.target.result;
                        const lines = csv.split('\n').filter((line) => line.trim());

                        if (lines.length < 2) {
                          alert('Error: CSV file must have at least a header row and one data row.');
                          return;
                        }

                        const importedSlots = [];
                        for (let i = 1; i < lines.length; i += 1) {
                          const values = lines[i].split(',').map((v) => v.trim().replace(/"/g, ''));
                          if (values.length >= 3) {
                            // Extract hour from time format (e.g., "09:00" -> "9")
                            const hourStr = values[0].split(':')[0];
                            const hour = parseInt(hourStr, 10).toString();

                            const docsPerHour = values[2] || '';

                            // Skip rows with empty docs per hour
                            if (!docsPerHour || docsPerHour.trim() === '') {
                              continue;
                            }

                            const slot = {
                              hour,
                              documentType: values[1] || '',
                              docsPerHour,
                            };
                            importedSlots.push(slot);
                          }
                        }

                        if (importedSlots.length > 0) {
                          setProcessingConfig({
                            ...processingConfig,
                            timeSlots: importedSlots,
                          });
                          alert(`Imported ${importedSlots.length} schedule entries`);
                        }
                      } catch (error) {
                        alert('Error parsing CSV file. Please check format.\nExpected format: Hour,Document Type,Docs Per Hour');
                      }
                    };
                    reader.readAsText(file);
                  };
                  input.click();
                }}
              >
                Import Schedule CSV
              </Button>

              <Button
                variant="normal"
                iconName="download"
                onClick={() => {
                  // Create CSV content for processing schedule
                  let csvContent = 'Hour,Document Type,Docs Per Hour\n';

                  processingConfig.timeSlots.forEach((slot) => {
                    const hourDisplay = slot.hour ? `${String(slot.hour).padStart(2, '0')}:00` : '00:00';
                    const row = [`"${hourDisplay}"`, `"${slot.documentType || ''}"`, `"${slot.docsPerHour || ''}"`].join(',');
                    csvContent += `${row}\n`;
                  });

                  const dataBlob = new Blob([csvContent], { type: 'text/csv' });
                  const url = URL.createObjectURL(dataBlob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'processing-schedule.csv';
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  URL.revokeObjectURL(url);
                }}
              >
                Export Schedule CSV
              </Button>
            </SpaceBetween>
          </SpaceBetween>
        </Container>

        {/* Processing Configuration */}
        <Container header={<Header variant="h2">Processing Configuration</Header>}>
          <FormField
            label="Max Latency (minutes)"
            description="Maximum acceptable latency for document processing - choose based on your SLA requirements"
          >
            <Select
              selectedOption={{
                label: `${processingConfig.maxLatency} minutes`,
                value: processingConfig.maxLatency,
              }}
              onChange={({ detail }) => setProcessingConfig({ ...processingConfig, maxLatency: detail.selectedOption.value })}
              options={(() => {
                // Get latency options from environment - required for capacity planning
                const latencyOptionsConfig = import.meta.env.VITE_LATENCY_OPTIONS;
                if (!latencyOptionsConfig) {
                  console.warn('VITE_LATENCY_OPTIONS environment variable is not configured');
                  return [{ label: 'Configuration required', value: '0', disabled: true }];
                }
                try {
                  const options = JSON.parse(latencyOptionsConfig);
                  if (!Array.isArray(options) || options.length === 0) {
                    console.error('VITE_LATENCY_OPTIONS must be a non-empty array');
                    return [{ label: 'Invalid configuration', value: '0', disabled: true }];
                  }
                  return options.map((option) => ({
                    label: `${option} minutes`,
                    value: option.toString(),
                  }));
                } catch (e) {
                  console.error('VITE_LATENCY_OPTIONS contains invalid JSON');
                  return [{ label: 'Invalid JSON', value: '0', disabled: true }];
                }
              })()}
              placeholder="Select latency requirement"
            />
          </FormField>
        </Container>

        {/* Calculate Button */}
        <Button variant="primary" size="large" onClick={calculateCapacityRequirements} loading={loading}>
          Calculate Capacity Requirements
        </Button>

        {results?.success === false && results?.metrics && (
          <Alert type="warning">
            <strong>⚠️ API Unavailable - Using Local Calculations:</strong> {results.errorMessage}
            <Box marginTop="xs">
              The capacity calculation service is temporarily unavailable. Showing estimated values based on your configuration. Please try
              again later for precise calculations.
            </Box>
          </Alert>
        )}

        {/* Capacity Results - Only show after calculation */}
        {hasCalculated && (
          <Container header={<Header variant="h2">Capacity Results</Header>}>
            <Cards
              cardDefinition={{
                header: (item) => item.label,
                sections: [
                  {
                    content: (item) => (
                      <Box fontSize="display-l" fontWeight="bold" color="text-status-info">
                        {item.value}
                      </Box>
                    ),
                  },
                ],
              }}
              items={capacityMetrics.filter((metric) => metric.label !== 'Cost')}
              cardsPerRow={[{ cards: 3 }]}
            />
          </Container>
        )}

        {/* AWS Service Quota Analysis - Only show after calculation */}
        {hasCalculated && (
          <Container header={<Header variant="h2">AWS Service Quota Analysis</Header>}>
            <SpaceBetween size="m">
              <Box>Review current quota against projected requirements</Box>
              <Box>
                <strong>Max Allowed Latency (minutes):</strong> {processingConfig.maxLatency}
              </Box>

              {/* Debug information for empty quota data */}
              {quotaData.length === 0 && (
                <Alert type="warning" header="No Quota Requirements Found">
                  <SpaceBetween size="s">
                    <div>No quota requirements were returned from the capacity calculation.</div>
                    <div>
                      <strong>Possible causes:</strong>
                    </div>
                    <ul>
                      <li>No document processing configured (check Document Processing section)</li>
                      <li>All OCR token values are zero</li>
                      <li>Backend calculation returned empty quota requirements</li>
                      <li>Pattern detection issue (check browser console for logs)</li>
                    </ul>
                    <div>
                      <strong>Debug info:</strong>
                    </div>
                    <div>Results success: {results?.success ? 'true' : 'false'}</div>
                    <div>Quota requirements length: {results?.quotaRequirements?.length || 0}</div>
                    <div>Has calculated: {hasCalculated ? 'true' : 'false'}</div>
                    <div>Pattern: {getDeployedPattern()}</div>
                    <div>
                      Document configs with OCR tokens:{' '}
                      {documentConfigs.filter((config) => config.ocrTokens && parseFloat(config.ocrTokens) > 0).length}
                    </div>
                    <details>
                      <summary>Full API Response</summary>
                      <pre style={{ fontSize: '12px', maxHeight: '200px', overflow: 'auto' }}>{JSON.stringify(results, null, 2)}</pre>
                    </details>
                  </SpaceBetween>
                </Alert>
              )}

              <Button
                variant="primary"
                iconName="download"
                onClick={() => {
                  const filename = prompt('Enter filename for export:', `capacity-planning-${getDeployedPattern()}`);
                  if (!filename) return;

                  // Create CSV content
                  let csvContent = 'Service,Category,Current Quota,Required Quota,Status\n';

                  quotaData.forEach((quota) => {
                    const row = [
                      `"${quota.service}"`,
                      `"${quota.category}"`,
                      `"${quota.currentQuota}"`,
                      `"${quota.requiredQuota}"`,
                      `"${quota.statusText}"`,
                    ].join(',');
                    csvContent += `${row}\n`;
                  });

                  // Add capacity metrics section
                  csvContent += '\nCapacity Metrics\n';
                  csvContent += 'Metric,Value\n';
                  capacityMetrics.forEach((metric) => {
                    csvContent += `"${metric.label}","${metric.value}"\n`;
                  });

                  // Add processing schedule section
                  csvContent += '\nProcessing Schedule\n';
                  csvContent += 'Hour,Document Type,Docs Per Hour\n';
                  processingConfig.timeSlots.forEach((slot) => {
                    csvContent += `"${slot.hour}:00","${slot.documentType}","${slot.docsPerHour}"\n`;
                  });

                  const dataBlob = new Blob([csvContent], { type: 'text/csv' });
                  const url = URL.createObjectURL(dataBlob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `${filename}.csv`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  URL.revokeObjectURL(url);
                }}
              >
                Export Quota Requirements
              </Button>

              {(() => {
                const groupedQuotas = groupQuotasByCategory(quotaData);
                // Filter out Infrastructure Services
                const filteredQuotas = Object.fromEntries(
                  Object.entries(groupedQuotas).filter(([category]) => category !== 'Infrastructure Services'),
                );

                return Object.entries(filteredQuotas).map(([category, quotas]) => (
                  <div key={category}>
                    <Header variant="h3">{category}</Header>
                    <Table
                      columnDefinitions={[
                        {
                          id: 'service',
                          header: 'Service',
                          cell: (item) => (
                            <div>
                              <div>{item.service}</div>
                              {item.category === 'Bedrock Models' && item.modelConfig && (
                                <div style={{ fontSize: '0.8em', color: '#666', marginTop: '4px' }}>
                                  Model: {item.modelConfig.model}
                                  <br />
                                  Temperature: {item.modelConfig.temperature}
                                  <br />
                                  Max Tokens: {item.modelConfig.max_tokens}
                                </div>
                              )}
                            </div>
                          ),
                        },
                        { id: 'current', header: 'Current Quota', cell: (item) => item.currentQuota },
                        { id: 'required', header: 'Required Quota', cell: (item) => item.requiredQuota },
                        {
                          id: 'status',
                          header: 'Status',
                          cell: (item) => {
                            const needsIncrease = item.statusText.includes('⚠️') || item.statusText.includes('Increase Needed');
                            const currentNum = parseInt(item.currentQuota.replace(/,/g, ''), 10);
                            const requiredNum = parseInt(item.requiredQuota.replace(/,/g, ''), 10);
                            const utilizationPercent = currentNum > 0 ? Math.round((requiredNum / currentNum) * 100) : 0;

                            return (
                              <div>
                                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{item.statusText}</div>
                                <div style={{ fontSize: '12px', color: '#687078' }}>
                                  {needsIncrease ? `${utilizationPercent}% of current quota needed` : `${utilizationPercent}% utilization`}
                                </div>
                              </div>
                            );
                          },
                        },
                        {
                          id: 'action',
                          header: 'Action',
                          width: 150,
                          cell: (item) => {
                            const needsIncrease =
                              item.statusText.includes('⚠️') ||
                              item.statusText.includes('Increase Needed') ||
                              item.statusText.includes('May Exceed');

                            if (needsIncrease) {
                              return (
                                <Button
                                  variant="primary"
                                  size="small"
                                  onClick={() => {
                                    // Extract quota code from the model ID - requires environment configuration
                                    const quotaCodesConfig = import.meta.env.VITE_BEDROCK_MODEL_QUOTA_CODES;
                                    if (!quotaCodesConfig) {
                                      // Open generic Bedrock quotas page when config is missing
                                      const region = import.meta.env.VITE_AWS_REGION || 'us-east-1';
                                      const serviceQuotasUrl = `https://${region}.console.aws.amazon.com/servicequotas/home/services/bedrock/quotas`;
                                      window.open(serviceQuotasUrl, '_blank');
                                      return;
                                    }
                                    let quotaCodes;
                                    try {
                                      quotaCodes = JSON.parse(quotaCodesConfig);
                                    } catch (e) {
                                      console.error('VITE_BEDROCK_MODEL_QUOTA_CODES contains invalid JSON');
                                      const region = import.meta.env.VITE_AWS_REGION || 'us-east-1';
                                      const serviceQuotasUrl = `https://${region}.console.aws.amazon.com/servicequotas/home/services/bedrock/quotas`;
                                      window.open(serviceQuotasUrl, '_blank');
                                      return;
                                    }
                                    const quotaCode = quotaCodes[item.modelId] || '';
                                    // Build AWS Service Quotas console URL using current region
                                    const region = import.meta.env.VITE_AWS_REGION;
                                    const serviceQuotasUrl = `https://${region}.console.aws.amazon.com/servicequotas/home/services/bedrock/quotas/${quotaCode}`;

                                    window.open(serviceQuotasUrl, '_blank');
                                  }}
                                  style={{
                                    whiteSpace: 'nowrap',
                                    minWidth: '120px',
                                  }}
                                >
                                  Request Increase
                                </Button>
                              );
                            }

                            return <Badge color="green">✓ Sufficient</Badge>;
                          },
                        },
                      ]}
                      items={quotas}
                      empty={<Box textAlign="center">No quota data available</Box>}
                    />
                  </div>
                ));
              })()}

              {/* Show message when no quota data */}
              {quotaData.length === 0 && (
                <Box textAlign="center" color="text-status-info">
                  <SpaceBetween size="s">
                    <div>No quota requirements to display</div>
                    <div>Check the debug information above for details</div>
                  </SpaceBetween>
                </Box>
              )}

              {/* Show "Generate AWS Support Request" button only if we have quota data */}
              {quotaData.length > 0 && (
                <Button
                  variant="primary"
                  onClick={() => {
                    // Generate comprehensive support request for all quota increases needed
                    const quotasNeedingIncrease = [];

                    Object.entries(groupQuotasByCategory(quotaData)).forEach(([category, quotas]) => {
                      quotas.forEach((quota) => {
                        if (quota.statusText.includes('⚠️') || quota.statusText.includes('Increase Needed')) {
                          quotasNeedingIncrease.push({
                            service: quota.service,
                            current: quota.currentQuota,
                            required: quota.requiredQuota,
                            category,
                            modelId: quota.modelId,
                          });
                        }
                      });
                    });

                    if (quotasNeedingIncrease.length === 0) {
                      alert('All quotas are currently sufficient for your capacity requirements.');
                      return;
                    }

                    // Open AWS Service Quotas console for Bedrock service using current region
                    const region = import.meta.env.VITE_AWS_REGION;

                    if (region) {
                      // User has AWS region - direct to Service Quotas console
                      const serviceQuotasUrl = `https://${region}.console.aws.amazon.com/servicequotas/home/services/bedrock/quotas`;
                      window.open(serviceQuotasUrl, '_blank');
                    } else {
                      // No region detected - direct to AWS Support Center for general quota requests
                      const supportUrl = 'https://console.aws.amazon.com/support/home#/case/create?issueType=service-limit-increase';
                      window.open(supportUrl, '_blank');
                    }
                  }}
                >
                  Generate AWS Support Request
                </Button>
              )}
            </SpaceBetween>
          </Container>
        )}

        {hasCalculated && (!results || !results.success) && (
          <Alert type="warning">
            <strong>Calculation Incomplete:</strong> The capacity calculation completed but returned incomplete data. This may be due to
            missing AWS service quotas. Please check your IAM permissions and try again.
          </Alert>
        )}

        {/* Tokens per Hour Analysis */}
        {hasCalculated && (
          <>
            <Container header={<Header variant="h2">Tokens per Hour Analysis</Header>}>
              <SpaceBetween size="m">
                <Header variant="h3">📊 Hourly Token Distribution</Header>
                <Box>
                  <div
                    style={{
                      height: '350px',
                      background: '#f9f9f9',
                      border: '1px solid #d5dbdb',
                      borderRadius: '4px',
                      position: 'relative',
                      padding: '30px',
                      overflowX: 'auto',
                    }}
                  >
                    {hasCalculated ? (
                      <>
                        {/* Y-axis labels */}
                        <div
                          style={{
                            position: 'absolute',
                            left: '5px',
                            top: '25px',
                            fontSize: '10px',
                            color: '#687078',
                          }}
                        >
                          Max
                        </div>
                        <div
                          style={{
                            position: 'absolute',
                            left: '5px',
                            top: '65px',
                            fontSize: '10px',
                            color: '#687078',
                          }}
                        >
                          50%
                        </div>
                        <div
                          style={{
                            position: 'absolute',
                            left: '5px',
                            top: '125px',
                            fontSize: '10px',
                            color: '#687078',
                          }}
                        >
                          0
                        </div>

                        {/* Hourly token bars */}
                        {(() => {
                          // Generate hourly breakdown from processing schedule
                          const hourlyBreakdown = {};

                          // Initialize all 24 hours
                          for (let hour = 0; hour < 24; hour += 1) {
                            hourlyBreakdown[hour] = {
                              hour,
                              ocrTokens: 0,
                              classificationTokens: 0,
                              extractionTokens: 0,
                              summarizationTokens: 0,
                              assessmentTokens: 0,
                              totalTokens: 0,
                              documentTypes: [],
                            };
                          }

                          // Aggregate by hour from time slots
                          processingConfig.timeSlots.forEach((slot) => {
                            const hour = parseInt(slot.hour || 0, 10);
                            const docType = slot.documentType || 'Other';
                            const docsPerHour = parseInt(slot.docsPerHour || 0, 10);

                            if (docsPerHour > 0) {
                              const docConfig = documentConfigs.find((config) => config.type === docType) || {
                                ocrTokens: 0,
                                classificationTokens: 0,
                                extractionTokens: 0,
                                summarizationTokens: 0,
                                assessmentTokens: 0,
                              };

                              const ocrTokens = parseFloat(docConfig.ocrTokens || 0);
                              const classificationTokens = parseFloat(docConfig.classificationTokens || 0);
                              const extractionTokens = parseFloat(docConfig.extractionTokens || 0);
                              const summarizationTokens = parseFloat(docConfig.summarizationTokens || 0);
                              const assessmentTokens = parseFloat(docConfig.assessmentTokens || 0);

                              // Debug logging
                              console.log(`DEBUG: Hour ${hour}, DocType: ${docType}, DocsPerHour: ${docsPerHour}`);
                              console.log(
                                `DEBUG: Token config - OCR: ${ocrTokens}, Class: ${classificationTokens}, Extract: ${extractionTokens}, Assess: ${assessmentTokens}, Summ: ${summarizationTokens}`,
                              );

                              // Only include OCR tokens if Bedrock OCR is configured
                              const effectiveOcrTokens = configuration?.ocr?.backend === 'bedrock' ? ocrTokens : 0;

                              // Calculate tokens for this specific slot
                              const slotOcrTokens = effectiveOcrTokens * docsPerHour;
                              const slotClassificationTokens = classificationTokens * docsPerHour;
                              const slotExtractionTokens = extractionTokens * docsPerHour;
                              const slotSummarizationTokens = summarizationTokens * docsPerHour;
                              const slotAssessmentTokens = assessmentTokens * docsPerHour;

                              console.log(
                                `DEBUG: Slot tokens - OCR: ${slotOcrTokens}, Class: ${slotClassificationTokens}, Extract: ${slotExtractionTokens}, Assess: ${slotAssessmentTokens}, Summ: ${slotSummarizationTokens}`,
                              );

                              // Accumulate tokens for this hour (multiple slots can add to same hour)
                              hourlyBreakdown[hour].ocrTokens += slotOcrTokens;
                              hourlyBreakdown[hour].classificationTokens += slotClassificationTokens;
                              hourlyBreakdown[hour].extractionTokens += slotExtractionTokens;
                              hourlyBreakdown[hour].summarizationTokens += slotSummarizationTokens;
                              hourlyBreakdown[hour].assessmentTokens += slotAssessmentTokens;
                              hourlyBreakdown[hour].totalTokens +=
                                slotOcrTokens +
                                slotClassificationTokens +
                                slotExtractionTokens +
                                slotSummarizationTokens +
                                slotAssessmentTokens;

                              console.log(`DEBUG: Hour ${hour} accumulated total: ${hourlyBreakdown[hour].totalTokens}`);

                              // Track document types
                              if (!hourlyBreakdown[hour].documentTypes.includes(docType)) {
                                hourlyBreakdown[hour].documentTypes.push(docType);
                              }
                            }
                          });

                          // Find max tokens for scaling
                          const maxTokens = Math.max(...Object.values(hourlyBreakdown).map((h) => h.totalTokens), 1);
                          console.log(`DEBUG: Max tokens for scaling: ${maxTokens}`);

                          // Only show hours with processing activity
                          const activeHours = Object.values(hourlyBreakdown).filter((h) => h.totalTokens > 0);
                          console.log(
                            `DEBUG: Active hours:`,
                            activeHours.map((h) => `Hour ${h.hour}: ${h.totalTokens} tokens`),
                          );

                          return activeHours.map((hourData, index) => {
                            const height = maxTokens > 0 ? Math.max((hourData.totalTokens / maxTokens) * 150, 8) : 8;
                            const leftPos = 60 + index * 80;

                            // Calculate proportional heights for each inference type
                            const ocrHeight = maxTokens > 0 ? (hourData.ocrTokens / maxTokens) * 150 : 0;
                            const classificationHeight = maxTokens > 0 ? (hourData.classificationTokens / maxTokens) * 150 : 0;
                            const extractionHeight = maxTokens > 0 ? (hourData.extractionTokens / maxTokens) * 150 : 0;
                            const assessmentHeight = maxTokens > 0 ? (hourData.assessmentTokens / maxTokens) * 150 : 0;
                            const summarizationHeight = maxTokens > 0 ? (hourData.summarizationTokens / maxTokens) * 150 : 0;

                            return (
                              <div key={hourData.hour}>
                                {/* Stacked bar segments */}
                                {configuration?.ocr?.backend === 'bedrock' && ocrHeight > 0 && (
                                  <div
                                    style={{
                                      position: 'absolute',
                                      bottom: '60px',
                                      left: `${leftPos}px`,
                                      width: '50px',
                                      height: `${ocrHeight}px`,
                                      background: '#9333ea', // Purple for OCR
                                      borderRadius: '3px 3px 0 0',
                                      cursor: 'pointer',
                                    }}
                                    title={`Hour ${hourData.hour}: OCR ${hourData.ocrTokens.toLocaleString()} tokens`}
                                  />
                                )}
                                {classificationHeight > 0 && (
                                  <div
                                    style={{
                                      position: 'absolute',
                                      bottom: `${60 + (configuration?.ocr?.backend === 'bedrock' ? ocrHeight : 0)}px`,
                                      left: `${leftPos}px`,
                                      width: '50px',
                                      height: `${classificationHeight}px`,
                                      background: '#f59e0b', // Orange for classification
                                      borderRadius:
                                        classificationHeight > 0 && !(configuration?.ocr?.backend === 'bedrock') ? '3px 3px 0 0' : '0',
                                      cursor: 'pointer',
                                    }}
                                    title={`Hour ${hourData.hour}: Classification ${hourData.classificationTokens.toLocaleString()} tokens`}
                                  />
                                )}
                                {extractionHeight > 0 && (
                                  <div
                                    style={{
                                      position: 'absolute',
                                      bottom: `${
                                        60 + (configuration?.ocr?.backend === 'bedrock' ? ocrHeight : 0) + classificationHeight
                                      }px`,
                                      left: `${leftPos}px`,
                                      width: '50px',
                                      height: `${extractionHeight}px`,
                                      background: '#10b981', // Green for extraction
                                      cursor: 'pointer',
                                    }}
                                    title={`Hour ${hourData.hour}: Extraction ${hourData.extractionTokens.toLocaleString()} tokens`}
                                  />
                                )}
                                {assessmentHeight > 0 && (
                                  <div
                                    style={{
                                      position: 'absolute',
                                      bottom: `${
                                        60 +
                                        (configuration?.ocr?.backend === 'bedrock' ? ocrHeight : 0) +
                                        classificationHeight +
                                        extractionHeight
                                      }px`,
                                      left: `${leftPos}px`,
                                      width: '50px',
                                      height: `${assessmentHeight}px`,
                                      background: '#3b82f6', // Blue for assessment
                                      cursor: 'pointer',
                                    }}
                                    title={`Hour ${hourData.hour}: Assessment ${hourData.assessmentTokens.toLocaleString()} tokens`}
                                  />
                                )}
                                {summarizationHeight > 0 && (
                                  <div
                                    style={{
                                      position: 'absolute',
                                      bottom: `${
                                        60 +
                                        (configuration?.ocr?.backend === 'bedrock' ? ocrHeight : 0) +
                                        classificationHeight +
                                        extractionHeight +
                                        assessmentHeight
                                      }px`,
                                      left: `${leftPos}px`,
                                      width: '50px',
                                      height: `${summarizationHeight}px`,
                                      background: '#ef4444', // Red for summarization
                                      borderRadius: '3px 3px 0 0',
                                      cursor: 'pointer',
                                    }}
                                    title={`Hour ${hourData.hour}: Summarization ${hourData.summarizationTokens.toLocaleString()} tokens`}
                                  />
                                )}
                                <div
                                  style={{
                                    position: 'absolute',
                                    bottom: '35px',
                                    left: `${leftPos - 10}px`,
                                    fontSize: '12px',
                                    color: '#687078',
                                    width: '70px',
                                    textAlign: 'center',
                                  }}
                                >
                                  {String(hourData.hour).padStart(2, '0')}:00
                                </div>
                                <div
                                  style={{
                                    position: 'absolute',
                                    bottom: `${70 + height}px`,
                                    left: `${leftPos - 15}px`,
                                    fontSize: '11px',
                                    color: '#232f3e',
                                    fontWeight: '600',
                                    width: '80px',
                                    textAlign: 'center',
                                  }}
                                >
                                  {hourData.totalTokens > 0 ? `${(hourData.totalTokens / 1000).toFixed(1)}K` : '0'}
                                </div>
                              </div>
                            );
                          });
                        })()}

                        {/* Legend - Dynamic based on pattern */}
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '5px',
                            right: '10px',
                            fontSize: '8px',
                            color: '#687078',
                          }}
                        >
                          {(() => {
                            const pattern = getDeployedPattern();
                            const isBedrockOcr = configuration?.ocr?.backend === 'bedrock';

                            if (pattern === 'PATTERN-1') {
                              return (
                                <>
                                  <span style={{ color: '#ef4444' }}>■</span> Summarization
                                </>
                              );
                            }
                            return (
                              <>
                                {isBedrockOcr && (
                                  <>
                                    <span style={{ color: '#9333ea' }}>■</span> OCR
                                    <span style={{ marginLeft: '8px' }} />
                                  </>
                                )}
                                <span style={{ color: '#f59e0b' }}>■</span> Classification
                                <span style={{ color: '#10b981', marginLeft: '8px' }}>■</span> Extraction
                                <span style={{ color: '#3b82f6', marginLeft: '8px' }}>■</span> Assessment
                                <span style={{ color: '#ef4444', marginLeft: '8px' }}>■</span> Summarization
                              </>
                            );
                          })()}
                        </div>
                      </>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: '100%',
                          color: '#687078',
                          fontSize: '14px',
                        }}
                      />
                    )}
                  </div>

                  {/* Peak Hour Analysis */}
                  {hasCalculated && (
                    <div style={{ marginTop: '15px', padding: '10px', background: '#f9f9f9', borderRadius: '4px' }}>
                      <div style={{ fontWeight: '600', marginBottom: '8px' }}>📈 Peak Hour Analysis</div>
                      {(() => {
                        const hourlyBreakdown = {};
                        for (let hour = 0; hour < 24; hour += 1) {
                          hourlyBreakdown[hour] = {
                            hour,
                            ocrTokens: 0,
                            classificationTokens: 0,
                            extractionTokens: 0,
                            summarizationTokens: 0,
                            assessmentTokens: 0,
                            totalTokens: 0,
                          };
                        }

                        processingConfig.timeSlots.forEach((slot) => {
                          const hour = parseInt(slot.hour || 0, 10);
                          const docType = slot.documentType || 'Other';
                          const docsPerHour = parseInt(slot.docsPerHour || 0, 10);
                          if (docsPerHour > 0) {
                            const docConfig = documentConfigs.find((config) => config.type === docType) || {
                              ocrTokens: 0,
                              classificationTokens: 0,
                              extractionTokens: 0,
                              summarizationTokens: 0,
                              assessmentTokens: 0,
                            };
                            const ocrTokensPerDoc = parseFloat(docConfig.ocrTokens || 0);
                            const classificationTokensPerDoc = parseFloat(docConfig.classificationTokens || 0);
                            const extractionTokensPerDoc = parseFloat(docConfig.extractionTokens || 0);
                            const summarizationTokensPerDoc = parseFloat(docConfig.summarizationTokens || 0);
                            const assessmentTokensPerDoc = parseFloat(docConfig.assessmentTokens || 0);

                            // Only include OCR tokens if Bedrock OCR is configured
                            const effectiveOcrTokensPerDoc = configuration?.ocr?.backend === 'bedrock' ? ocrTokensPerDoc : 0;

                            // Calculate slot tokens (tokens per doc * docs per hour)
                            const slotOcrTokens = effectiveOcrTokensPerDoc * docsPerHour;
                            const slotClassificationTokens = classificationTokensPerDoc * docsPerHour;
                            const slotExtractionTokens = extractionTokensPerDoc * docsPerHour;
                            const slotSummarizationTokens = summarizationTokensPerDoc * docsPerHour;
                            const slotAssessmentTokens = assessmentTokensPerDoc * docsPerHour;

                            // Accumulate tokens for this hour
                            hourlyBreakdown[hour].ocrTokens += slotOcrTokens;
                            hourlyBreakdown[hour].classificationTokens += slotClassificationTokens;
                            hourlyBreakdown[hour].extractionTokens += slotExtractionTokens;
                            hourlyBreakdown[hour].summarizationTokens += slotSummarizationTokens;
                            hourlyBreakdown[hour].assessmentTokens += slotAssessmentTokens;
                            hourlyBreakdown[hour].totalTokens +=
                              slotOcrTokens +
                              slotClassificationTokens +
                              slotExtractionTokens +
                              slotSummarizationTokens +
                              slotAssessmentTokens;
                          }
                        });

                        const activeHours = Object.values(hourlyBreakdown).filter((h) => h.totalTokens > 0);
                        if (activeHours.length === 0) return <div>No processing hours configured</div>;

                        const peakHour = activeHours.reduce((max, hour) => (hour.totalTokens > max.totalTokens ? hour : max));
                        const avgTokens = activeHours.reduce((sum, hour) => sum + hour.totalTokens, 0) / activeHours.length;

                        const peakInference = Math.max(
                          peakHour.ocrTokens,
                          peakHour.classificationTokens,
                          peakHour.extractionTokens,
                          peakHour.assessmentTokens,
                          peakHour.summarizationTokens,
                        );
                        let peakInferenceType = 'Classification';
                        if (peakInference === peakHour.ocrTokens) peakInferenceType = 'OCR';
                        else if (peakInference === peakHour.extractionTokens) peakInferenceType = 'Extraction';
                        else if (peakInference === peakHour.assessmentTokens) peakInferenceType = 'Assessment';
                        else if (peakInference === peakHour.summarizationTokens) peakInferenceType = 'Summarization';

                        return (
                          <div style={{ fontSize: '12px', lineHeight: '1.4' }}>
                            <div>
                              Peak: {String(peakHour.hour).padStart(2, '0')}:00-
                              {/* eslint-disable-next-line max-len */}
                              {String(peakHour.hour + 1).padStart(2, '0')}:00 ({peakHour.totalTokens.toLocaleString()} tokens)
                            </div>
                            <div>
                              ⚡ <strong>Peak:</strong> {peakInferenceType} ({peakInference.toLocaleString()} tokens)
                            </div>
                            <div>
                              📊 <strong>Average Load:</strong> {avgTokens.toLocaleString()} tokens/hour across {activeHours.length} active
                              hours
                            </div>
                            <div>
                              📈 <strong>Peak vs Average:</strong> {((peakHour.totalTokens / avgTokens - 1) * 100).toFixed(1)}% above
                              average
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </Box>
              </SpaceBetween>
            </Container>

            {/* Latency Distribution Histogram */}
            {results?.success && results?.latencyDistribution && (
              <Container header={<Header variant="h2">Processing Latency Distribution</Header>}>
                <SpaceBetween size="l">
                  <Box>
                    <div style={{ marginBottom: '16px' }}>
                      <strong>Expected Processing Times:</strong> Based on your workload and current Bedrock quotas
                    </div>

                    {/* Latency Bars */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {(() => {
                        const latency = results.latencyDistribution;
                        const percentiles = [
                          { label: 'P50 (Median)', key: 'p50', description: '50% of documents complete within' },
                          { label: 'P75', key: 'p75', description: '75% of documents complete within' },
                          { label: 'P90', key: 'p90', description: '90% of documents complete within' },
                          { label: 'P95', key: 'p95', description: '95% of documents complete within' },
                          { label: 'P99 (Worst Case)', key: 'p99', description: '99% of documents complete within' },
                        ];

                        // Parse values and use max allowed latency as scaling reference
                        const values = percentiles.map((p) => parseFloat(latency[p.key]?.replace('s', '') || '0'));
                        const maxAllowed = parseFloat(latency.maxAllowed?.replace('s', '') || '300');
                        // Use max allowed latency as the scaling reference so bars show absolute differences
                        const scalingReference = maxAllowed;

                        return percentiles.map((percentile, index) => {
                          const value = values[index];
                          // Scale against max allowed latency instead of max value in this response
                          const percentage = scalingReference > 0 ? Math.min((value / scalingReference) * 100, 100) : 0;
                          const exceedsLimit = value > maxAllowed;

                          // Color coding based on performance
                          let barColor = '#0073bb'; // Default blue
                          if (exceedsLimit) {
                            barColor = '#d13212'; // Red for exceeding limits
                          } else if (value > maxAllowed * 0.8) {
                            barColor = '#ff9900'; // Orange for approaching limits
                          } else if (index <= 1) {
                            barColor = '#037f0c'; // Green for good performance (P50, P75)
                          }

                          return (
                            <div key={percentile.key} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <div style={{ minWidth: '120px', fontSize: '14px', fontWeight: '500' }}>{percentile.label}</div>
                              <div style={{ flex: 1, position: 'relative' }}>
                                <div
                                  style={{
                                    width: `${Math.max(percentage, 5)}%`,
                                    height: '24px',
                                    backgroundColor: barColor,
                                    borderRadius: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    paddingLeft: '8px',
                                    color: 'white',
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    minWidth: '60px',
                                  }}
                                >
                                  {latency[percentile.key]}
                                </div>
                                {exceedsLimit && (
                                  <Badge color="red" style={{ marginLeft: '8px' }}>
                                    Exceeds SLA
                                  </Badge>
                                )}
                              </div>
                              <div style={{ minWidth: '200px', fontSize: '12px', color: '#5f6b7a' }}>{percentile.description}</div>
                            </div>
                          );
                        });
                      })()}
                    </div>

                    {/* Summary Information */}
                    <Box marginTop="l">
                      <ColumnLayout columns={3} variant="text-grid">
                        <div>
                          <Box variant="awsui-key-label">Base Processing Time</Box>
                          <div style={{ fontSize: '16px', fontWeight: '600' }}>{results.latencyDistribution.baseLatency}</div>
                          <div style={{ fontSize: '12px', color: '#5f6b7a' }}>Time for OCR, classification, extraction, etc.</div>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">Queue Delay</Box>
                          <div style={{ fontSize: '16px', fontWeight: '600' }}>{results.latencyDistribution.queueLatency}</div>
                          <div style={{ fontSize: '12px', color: '#5f6b7a' }}>Additional wait time due to high volume</div>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">SLA Target</Box>
                          <div style={{ fontSize: '16px', fontWeight: '600' }}>{results.latencyDistribution.maxAllowed}</div>
                          <div style={{ fontSize: '12px', color: '#5f6b7a' }}>Maximum acceptable processing time</div>
                        </div>
                      </ColumnLayout>
                    </Box>

                    {/* Performance Alert */}
                    {results.latencyDistribution.exceedsLimit && (
                      <Alert type="warning">
                        <strong>⚠️ Performance Warning:</strong> Your P99 latency exceeds the configured SLA target. Consider increasing
                        Bedrock quotas or reducing document volume during peak hours.
                      </Alert>
                    )}
                  </Box>
                </SpaceBetween>
              </Container>
            )}
          </>
        )}

        {hasCalculated && (!results || !results.success) && (
          <Alert type="warning">
            <strong>Calculation Incomplete:</strong> The capacity calculation completed but returned incomplete data. This may be due to
            missing AWS service quotas. Please check your IAM permissions and try again.
          </Alert>
        )}
      </SpaceBetween>

      {/* Document Picker Modal */}
      <Modal
        visible={showDocumentPicker}
        onDismiss={() => {
          setShowDocumentPicker(false);
          setSelectedDocuments([]);
        }}
        header="Select Documents to Populate Tokens"
        size="max"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="s">
              {selectedDocuments.length > 0 && (
                <Button variant="primary" onClick={populateTokensFromMultipleDocuments}>
                  Use Selected Documents ({selectedDocuments.length})
                </Button>
              )}
              <Button
                variant="link"
                onClick={() => {
                  setShowDocumentPicker(false);
                  setSelectedDocuments([]);
                }}
              >
                Cancel
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Box>Select a recently processed document to automatically populate token usage values from the estimated cost section.</Box>

          {recentDocuments.length === 0 ? (
            <Box textAlign="center" color="text-status-info">
              No processed documents found. Process some documents first to see token usage data.
            </Box>
          ) : (
            <Table
              columnDefinitions={[
                {
                  id: 'select',
                  header: '',
                  cell: (item) => (
                    <Checkbox
                      checked={selectedDocuments.some((doc) => doc.ObjectKey === item.ObjectKey)}
                      onChange={({ detail }) => handleDocumentSelection(item, detail.checked)}
                    />
                  ),
                  width: 50,
                },
                {
                  id: 'ObjectKey',
                  header: 'Document Type',
                  cell: (item) => item.ObjectKey,
                  width: 150,
                },
                {
                  id: 'documentClass',
                  header: 'Document Class',
                  cell: (item) => item.documentClass,
                  width: 100,
                },
                {
                  id: 'tokens',
                  header: 'Token Usage for each Processing step',
                  cell: (item) => (
                    <Box fontSize="body-s">
                      {configuration?.ocr?.backend === 'bedrock' && item.metering?.ocrTokens && (
                        <div>
                          <strong>OCR:</strong> {item.metering.ocrTokens.toLocaleString()}
                        </div>
                      )}
                      {item.metering?.classificationTokens && (
                        <div>
                          <strong>Classification:</strong> {item.metering.classificationTokens.toLocaleString()}
                        </div>
                      )}
                      {item.metering?.extractionTokens && (
                        <div>
                          <strong>Extraction:</strong> {item.metering.extractionTokens.toLocaleString()}
                        </div>
                      )}
                      {item.metering?.assessmentTokens && (
                        <div>
                          <strong>Assessment:</strong> {item.metering.assessmentTokens.toLocaleString()}
                        </div>
                      )}
                      {item.metering?.summarizationTokens && (
                        <div>
                          <strong>Summarization:</strong> {item.metering.summarizationTokens.toLocaleString()}
                        </div>
                      )}
                    </Box>
                  ),
                },
                {
                  id: 'action',
                  header: 'Action',
                  cell: (item) => (
                    <Button
                      variant="primary"
                      size="normal"
                      onClick={() => populateTokensFromDocument(item)}
                      style={{
                        whiteSpace: 'nowrap',
                        minWidth: '130px',
                        padding: '8px 16px',
                      }}
                    >
                      Use this Document
                    </Button>
                  ),
                  width: 180,
                },
              ]}
              items={recentDocuments}
              empty={<Box textAlign="center">No documents available</Box>}
            />
          )}
        </SpaceBetween>
      </Modal>
    </Container>
  );
};

export default CapacityPlanningLayout;
