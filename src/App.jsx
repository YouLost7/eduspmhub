import { Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import UserAppShell from "./components/UserAppShell.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import PlatformPage from "./pages/PlatformPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import BrowsePage from "./pages/BrowsePage.jsx";
import MyCoursesPage from "./pages/MyCoursesPage.jsx";
import CoursePlayerPage from "./pages/CoursePlayerPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import TutorProfilePage from "./pages/TutorProfilePage.jsx";
import StaffVerificationPage from "./pages/StaffVerificationPage.jsx";
import TransactionsPage from "./pages/TransactionsPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/platform" element={<PlatformPage />} />
      <Route path="/staff" element={<StaffVerificationPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<UserAppShell />}>
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/tutor/:tutorId" element={<TutorProfilePage />} />
          <Route path="/my-courses" element={<MyCoursesPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/learn/:courseId" element={<CoursePlayerPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Route>
    </Routes>
  );
}
