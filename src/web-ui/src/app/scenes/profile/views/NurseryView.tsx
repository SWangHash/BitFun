import React from 'react';
import { useNurseryStore } from '../nurseryStore';
import NurseryGallery from './NurseryGallery';
import TemplateConfigPage from './TemplateConfigPage';
import AssistantConfigPage from './AssistantConfigPage';
import './NurseryView.scss';

const NurseryView: React.FC = () => {
  const { page } = useNurseryStore();

  if (page === 'template') {
    return <TemplateConfigPage />;
  }

  if (page === 'assistant') {
    return <AssistantConfigPage />;
  }

  return <NurseryGallery />;
};

export default NurseryView;
