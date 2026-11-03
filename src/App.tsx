import React, { useState } from 'react';
import { ThemeProvider, useTheme } from './context/ThemeContext.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { Sidebar } from './components/layout/Sidebar.tsx';
import { RightSidebar } from './components/layout/RightSidebar.tsx';
import { MobileNav } from './components/layout/MobileNav.tsx';
import { Timeline } from './components/feed/Timeline.tsx';
import { PostDetailModal } from './components/feed/PostDetailModal.tsx';
import { PostComposer } from './components/feed/PostComposer.tsx';
import { Modal } from './components/common/Modal.tsx';
import { ExploreView } from './components/explore/ExploreView.tsx';
import { NotificationsView } from './components/notifications/NotificationsView.tsx';
import { BookmarksView } from './components/bookmarks/BookmarksView.tsx';
import { MessagesView } from './components/messages/MessagesView.tsx';
import { ProfileView } from './components/profile/ProfileView.tsx';
import { LauncherSplash } from './components/common/LauncherSplash.tsx';
import { AuthModal } from './components/auth/AuthModal.tsx';
import { Post } from './types/index.ts';

function MainApp() {
  const { theme } = useTheme();
  const { isLoading, isAuthModalOpen, setIsAuthModalOpen, appConfig } = useAuth();

  const [currentTab, setCurrentTab] = useState<string>('home');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [targetUsername, setTargetUsername] = useState<string | null>(null);
  const [exploreQuery, setExploreQuery] = useState<string>('');
  const [isComposeOpen, setIsComposeOpen] = useState<boolean>(false);

  const handlePostClick = (post: Post) => {
    setSelectedPostId(post.id);
  };

  const handleReplyClick = (post: Post) => {
    setSelectedPostId(post.id);
  };

  const handleUserClick = (username: string) => {
    setTargetUsername(username);
    setCurrentTab('profile');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTagClick = (tag: string) => {
    setExploreQuery(tag);
    setCurrentTab('explore');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearch = (query: string) => {
    setExploreQuery(query);
    setCurrentTab('explore');
  };

  return (
    <div className="min-h-screen flex justify-center selection:bg-sky-500 selection:text-white">
      {/* App Launcher Loading Splash Screen */}
      <LauncherSplash isLoading={isLoading} appName={appConfig?.appName} />

      {/* 3-Column Responsive Container */}
      <div className="flex w-full max-w-7xl justify-between">
        {/* Left Navigation Sidebar (Node.js engine & configuration tabs removed) */}
        <Sidebar
          currentTab={currentTab}
          onSelectTab={(tab) => {
            if (tab === 'profile') setTargetUsername(null);
            setCurrentTab(tab);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onOpenCompose={() => setIsComposeOpen(true)}
        />

        {/* Center Main Social Feed View */}
        <main className="flex-1 min-h-screen border-r border-neutral-800/80 max-w-2xl pb-16 sm:pb-0">
          {currentTab === 'home' && (
            <Timeline
              onPostClick={handlePostClick}
              onReplyClick={handleReplyClick}
              onUserClick={handleUserClick}
              onTagClick={handleTagClick}
            />
          )}

          {currentTab === 'explore' && (
            <ExploreView
              initialQuery={exploreQuery}
              onPostClick={handlePostClick}
              onReplyClick={handleReplyClick}
              onUserClick={handleUserClick}
              onTagClick={handleTagClick}
            />
          )}

          {currentTab === 'notifications' && (
            <NotificationsView
              onPostClick={(id) => setSelectedPostId(id)}
              onUserClick={handleUserClick}
            />
          )}

          {currentTab === 'bookmarks' && (
            <BookmarksView
              onPostClick={handlePostClick}
              onReplyClick={handleReplyClick}
              onUserClick={handleUserClick}
              onTagClick={handleTagClick}
            />
          )}

          {currentTab === 'messages' && (
            <MessagesView />
          )}

          {currentTab === 'profile' && (
            <ProfileView
              username={targetUsername || undefined}
              onBack={() => {
                setTargetUsername(null);
                setCurrentTab('home');
              }}
              onPostClick={handlePostClick}
              onReplyClick={handleReplyClick}
              onUserClick={handleUserClick}
              onTagClick={handleTagClick}
            />
          )}
        </main>

        {/* Right Sidebar Widgets */}
        <RightSidebar
          onSearch={handleSearch}
          onSelectTag={handleTagClick}
        />
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav
        currentTab={currentTab}
        onSelectTab={(tab) => {
          if (tab === 'profile') setTargetUsername(null);
          setCurrentTab(tab);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      {/* Backend-Controlled Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* Post Detail / Thread Modal */}
      <PostDetailModal
        postId={selectedPostId}
        onClose={() => setSelectedPostId(null)}
        onUserClick={handleUserClick}
        onTagClick={handleTagClick}
      />

      {/* Floating Compose Modal */}
      {isComposeOpen && (
        <Modal
          isOpen={isComposeOpen}
          onClose={() => setIsComposeOpen(false)}
          title="Compose Transmission"
          maxWidth="max-w-xl"
        >
          <PostComposer
            isModal={true}
            onPostCreated={() => setIsComposeOpen(false)}
            onClose={() => setIsComposeOpen(false)}
          />
        </Modal>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </ThemeProvider>
  );
}
