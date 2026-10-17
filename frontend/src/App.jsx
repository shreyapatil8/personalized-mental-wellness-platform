import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import AssistantPage from "./pages/AssistantPage.jsx";
import CounsellingPage from "./pages/CounsellingPage.jsx";
import CounsellingSessionPage from "./pages/CounsellingSessionPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import IntelligencePage from "./pages/IntelligencePage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import PredictionPage from "./pages/PredictionPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import TrackingPage from "./pages/TrackingPage.jsx";
import FeedbackPage from "./pages/FeedbackPage.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import InitialWellnessAssessmentPage from "./pages/InitialWellnessAssessmentPage.jsx";
import WellnessOverviewPage from "./pages/WellnessOverviewPage.jsx";
import { useAuth } from "./context/useAuth.js";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/wellness-assessment" element={<ProtectedRoute><InitialWellnessAssessmentPage /></ProtectedRoute>} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register/counsellor" element={<RegisterPage key="counsellor" role="counsellor" />} />
      <Route path="/" element={<EntryLayout />}>
        <Route index element={<DashboardPage />} />
      </Route>
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/counselling" element={<CounsellingPage />} />
        <Route path="/counselling/:appointmentId/session" element={<CounsellingSessionPage />} />
        <Route path="/intelligence" element={<IntelligencePage />} />
        <Route path="/prediction" element={<PredictionPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/wellness-overview" element={<WellnessOverviewPage />} />
        <Route path="/tracking" element={<TrackingPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function EntryLayout() {
  const { user, booting } = useAuth();
  if (!booting && !user) return <LandingPage />;
  return <ProtectedRoute><Layout /></ProtectedRoute>;
}

