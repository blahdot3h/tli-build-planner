import { useState } from 'react';
import { useLiveData, useNow } from './useLiveData.js';
import StatusBar from './components/StatusBar.jsx';
import CharacterHeader from './components/CharacterHeader.jsx';
import Equipment from './components/Equipment.jsx';
import { Skills, HeroPanel, Pactspirits } from './components/BuildPanels.jsx';
import SlateBoard from './components/SlateBoard.jsx';
import TalentTrees from './components/TalentTrees.jsx';
import TalentAdvisor from './components/TalentAdvisor.jsx';
import StatsPanel from './components/StatsPanel.jsx';
import DpsPanel from './components/DpsPanel.jsx';
import DummyTests from './components/DummyTests.jsx';
import PactspiritOptimizer from './components/PactspiritOptimizer.jsx';
import BuildChoices from './components/BuildChoices.jsx';
import Feed from './components/Feed.jsx';
import MissingData from './components/MissingData.jsx';
import FollowerPanel from './components/FollowerPanel.jsx';
import SampleBuild from './components/sample/SampleBuild.jsx';
import FarmPanel from './components/FarmPanel.jsx';
import MarketPanel from './components/MarketPanel.jsx';

// Which page is shown: the logged character, the sample build planner or the farming tracker
// (remembered per browser)
function useMode() {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem('planner-mode') ?? 'live';
    } catch {
      return 'live';
    }
  });
  const choose = (m) => {
    setMode(m);
    try {
      localStorage.setItem('planner-mode', m);
    } catch {
      // Private windows can refuse storage; the choice just isn't remembered
    }
  };
  return [mode, choose];
}

function ModeTabs({ mode, onMode }) {
  return (
    <nav className="mode-tabs">
      <button className={mode === 'live' ? 'on' : ''} onClick={() => onMode('live')}>
        My character (from the log)
      </button>
      <button className={mode === 'sample' ? 'on' : ''} onClick={() => onMode('sample')}>
        Sample build (plan one)
      </button>
      <button className={mode === 'farm' ? 'on' : ''} onClick={() => onMode('farm')}>
        Farming (drops &amp; FE/hour)
      </button>
    </nav>
  );
}

export default function App() {
  const { status, character, feed, connected, reloadFeed, optimizer, talentAdvice, sample, sampleProgress, captures, farm, cloud } = useLiveData();
  const now = useNow();
  const [mode, setMode] = useMode();

  return (
    <div className="app">
      <StatusBar status={status} connected={connected} now={now} onRescanned={reloadFeed} />
      <ModeTabs mode={mode} onMode={setMode} />
      {mode === 'farm' ? (
        <section className="panel farm-page">
          <div className="panel-head">
            <h2>Farming</h2>
            <div className="panel-right">
              {window.overlayApp ? (
                <button className="primary" onClick={() => window.overlayApp.layout('mini')} title="Switch the in-game overlay to a small ETor-style box with just the figures (Ctrl+Shift+M); its 📌 pins it so every click reaches the game (Ctrl+Alt+P, changeable in the box's ⚙)">
                  Compact economy overlay (in game)
                </button>
              ) : (
                <span className="muted small">For the in-game compact overlay run the desktop app: npm run app</span>
              )}
            </div>
          </div>
          <p className="muted small">
            Drops and map runs read from the game log as you play, valued with ETor's market (the YiHuo ETor tracker's price service) and your own Exchange price checks. Click a drop's value to set your own price.
          </p>
          <FarmPanel farm={farm} />
        </section>
      ) : mode === 'sample' ? (
        <SampleBuild pushed={sample} progress={sampleProgress} />
      ) : character ? (
        <>
          <CharacterHeader character={character} characters={status?.characters} />
          <div className="layout">
            <div className="col-main">
              <Equipment equipment={character.equipment} now={now} calc={character.calc} />
              <Skills skills={character.skills} calc={character.calc} />
              <SlateBoard slates={character.slates} calc={character.calc} />
              <TalentTrees trees={character.talentTrees} layouts={character.calc.talentLayouts} advice={talentAdvice.result} />
              <TalentAdvisor advice={talentAdvice} />
              <PactspiritOptimizer optimizer={optimizer} equipped={character.pactspirits.filter((p) => p.area <= 3)} />
            </div>
            <div className="col-side">
              <MissingData needs={character.calc.needs} captures={captures} sources={character.calc.sources ?? null} />
              <DpsPanel calc={character.calc} dummyTests={character.dummyTests} />
              <DummyTests tests={character.dummyTests} gameStats={character.gameStats} calc={character.calc} />
              <MarketPanel cloud={cloud} farm={farm} equipment={character.equipment} />
              <BuildChoices
                choices={character.calc.choices ?? {}}
                logHeroId={character.player.heroId}
                logTraits={character.heroTraits}
                logPets={character.pactspirits.filter((p) => p.area <= 3)}
              />
              <StatsPanel calc={character.calc} gaps={character.gaps} gameStats={character.gameStats} />
              <Feed feed={feed} equipment={character.equipment} />
              <FollowerPanel calc={character.calc} />
              <HeroPanel traits={character.heroTraits} memories={character.memories} hero={character.calc.choices?.hero ?? character.calc.choices?.heroInferred} />
              <Pactspirits pactspirits={character.pactspirits} />
            </div>
          </div>
        </>
      ) : (
        <Waiting status={status} connected={connected} />
      )}
    </div>
  );
}

function Waiting({ status, connected }) {
  let message = 'Log found. Log in to a character in game (with logging enabled) and your build appears here.';
  if (!connected) message = 'Connecting to the planner server…';
  else if (!status?.logPath) message = "Couldn't find Torchlight Infinite's log. Set TLI_LOG_PATH in .env to the full path of UE_game.log.";
  else if (!status.fileExists) message = 'Waiting for the game to create UE_game.log. Start the game with logging enabled.';
  return (
    <div className="waiting">
      <h1>No character loaded yet</h1>
      <p>{message}</p>
    </div>
  );
}
