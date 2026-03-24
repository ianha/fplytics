import { Routes, Route } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { Dashboard } from "@/pages/Dashboard";
import { PlayersPage } from "@/pages/PlayersPage";
import { PlayerDetailPage } from "@/pages/PlayerDetailPage";
import { FixturesPage } from "@/pages/FixturesPage";
import { FDRPage } from "@/pages/FDRPage";
import { TeamDetailPage } from "@/pages/TeamDetailPage";
import { ChatPage } from "@/pages/ChatPage";
import { MyTeamPage } from "@/pages/MyTeamPage";

export default function App() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 min-w-0 lg:overflow-y-auto pt-14 lg:pt-0">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/players/:id" element={<PlayerDetailPage />} />
          <Route path="/fixtures" element={<FixturesPage />} />
          <Route path="/fixtures/fdr" element={<FDRPage />} />
          <Route path="/teams/:id" element={<TeamDetailPage />} />
          <Route path="/my-team" element={<MyTeamPage />} />
          <Route path="/chat" element={<ChatPage />} />
        </Routes>
      </main>
    </div>
  );
}
