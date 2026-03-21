import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import HistoryView from './components/HistoryView';
import { AppContextProvider } from './contexts/AppContext';

export default function App() {
    return (
        <AppContextProvider>
            <BrowserRouter>
                <Layout>
                    <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/history" element={<HistoryView />} />
                    </Routes>
                </Layout>
            </BrowserRouter>
        </AppContextProvider>
    );
}
