import { ReplayFixtureList } from "../../../components/campfire/ReplayFixtureList";

/**
 * Replay Index Screen
 *
 * Shows the list of historical fixtures available for replay when no live
 * fixture is active. The fan can select a fixture to enter replay mode.
 *
 * Requirement 11.1: WHEN no live fixture is available, THE Mobile_App SHALL
 * display a list of recent finished fixtures available for replay.
 */
export default function ReplayIndexScreen() {
  return <ReplayFixtureList />;
}
