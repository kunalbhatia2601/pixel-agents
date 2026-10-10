/**
 * AUTO-GENERATED FROM core/asyncapi.yaml. DO NOT EDIT MANUALLY.
 *
 * Run `npm run asyncapi:generate` to regenerate.
 *
 * Source of truth: the yaml at core/asyncapi.yaml.
 * Editors and clients in any language can consume the spec directly.
 */

export type ServerMessage =
  | ProviderCapabilities
  | AgentCreated
  | AgentClosed
  | AgentSelected
  | ExistingAgents
  | AgentStatus
  | AgentToolStart
  | AgentToolDone
  | AgentToolsClear
  | AgentToolPermission
  | AgentToolPermissionClear
  | SubagentToolStart
  | SubagentToolDone
  | SubagentClear
  | SubagentToolPermission
  | AgentTeamInfo
  | AgentContextUsage
  | LayoutLoaded
  | FurnitureAssetsLoaded
  | CharacterSpritesLoaded
  | PetSpritesLoaded
  | FloorTilesLoaded
  | WallTilesLoaded
  | CarpetTilesLoaded
  | SettingsLoaded
  | HooksStatus
  | HooksConsentRequest
  | ExternalAssetDirectoriesUpdated
  | AreaMappingsLoaded
  | WorkspaceFolders
  | AgentDiagnostics
  | ProjectsLoaded
  | TasksLoaded
  | PermissionAsked
  | PermissionResolved
  | ActionError
  | AgentDefaultsLoaded
  | AgentChat
  | FolderPicked
  | BranchesListed
  | AccountsLoaded;

export type ClientMessage =
  | WebviewReady
  | LaunchAgent
  | FocusAgent
  | CloseAgent
  | SaveAgentSeats
  | SaveLayout
  | SetSoundEnabled
  | SetLastSeenVersion
  | SetAlwaysShowLabels
  | SetGhostHeadlessAgents
  | SetHooksEnabled
  | HooksConsentResponse
  | SetHooksInfoShown
  | SetWatchAllSessions
  | ExportLayout
  | ImportLayout
  | OpenSessionsFolder
  | AddExternalAssetDirectory
  | RemoveExternalAssetDirectory
  | SaveAreaMappings
  | SetShowAreas
  | RequestDiagnostics
  | SaveProject
  | DeleteProject
  | StartTask
  | StopTask
  | AnswerPermission
  | SaveAgentDefaults
  | WatchAgentChat
  | UnwatchAgentChat
  | SendAgentMessage
  | InterruptAgent
  | PickFolder
  | ListBranches
  | SetAgentMode
  | CompleteTask
  | SaveAccount
  | DeleteAccount
  | TestAccount
  | SetAccountRoles;

export interface ProviderCapabilities {
  type: 'providerCapabilities';
  readingTools: string[];
  subagentToolNames: string[];
}

export interface AgentCreated {
  type: 'agentCreated';
  id: number;
  folderName?: string;
  isExternal?: boolean;
  palette?: number;
  hueShift?: number;
}

export interface AgentClosed {
  type: 'agentClosed';
  id: number;
}

export interface AgentSelected {
  type: 'agentSelected';
  id: number;
}

export interface ExistingAgents {
  type: 'existingAgents';
  agents: number[];
  agentMeta: Record<string, AgentSeatMeta>;
  folderNames: Record<string, string>;
  externalAgents: Record<string, boolean>;
}

export interface AgentSeatMeta {
  palette?: number;
  hueShift?: number;
  seatId?: string;
}

export interface AgentStatus {
  type: 'agentStatus';
  id: number;
  status: AgentActivityStatus;
  awaitingInput?: boolean;
}

export type AgentActivityStatus = 'active' | 'waiting';

export interface AgentToolStart {
  type: 'agentToolStart';
  id: number;
  toolId: string;
  status: string;
  toolName?: string;
  permissionActive?: boolean;
  runInBackground?: boolean;
  isTeammateSpawn?: boolean;
}

export interface AgentToolDone {
  type: 'agentToolDone';
  id: number;
  toolId: string;
}

export interface AgentToolsClear {
  type: 'agentToolsClear';
  id: number;
}

export interface AgentToolPermission {
  type: 'agentToolPermission';
  id: number;
}

export interface AgentToolPermissionClear {
  type: 'agentToolPermissionClear';
  id: number;
}

export interface SubagentToolStart {
  type: 'subagentToolStart';
  id: number;
  parentToolId: string;
  toolId: string;
  status: string;
}

export interface SubagentToolDone {
  type: 'subagentToolDone';
  id: number;
  parentToolId: string;
  toolId: string;
}

export interface SubagentClear {
  type: 'subagentClear';
  id: number;
  parentToolId: string;
}

export interface SubagentToolPermission {
  type: 'subagentToolPermission';
  id: number;
  parentToolId: string;
}

export interface AgentTeamInfo {
  type: 'agentTeamInfo';
  id: number;
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
}

export interface AgentContextUsage {
  type: 'agentContextUsage';
  id: number;
  contextTokens: number;
  maxContextTokens: number;
}

export interface LayoutLoaded {
  type: 'layoutLoaded';
  layout: Record<string, any> | null;
  wasReset?: boolean;
}

export interface FurnitureAssetsLoaded {
  type: 'furnitureAssetsLoaded';
  catalog: FurnitureAssetMessage[];
  sprites: Record<string, string[][]>;
}

export interface FurnitureAssetMessage {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

export interface CharacterSpritesLoaded {
  type: 'characterSpritesLoaded';
  characters: CharacterSpriteSet[];
}

export interface CharacterSpriteSet {
  down: string[][][];
  up: string[][][];
  right: string[][][];
}

export interface PetSpritesLoaded {
  type: 'petSpritesLoaded';
  pets: PetSpriteFrameSet[];
  petNames: string[];
}

export interface PetSpriteFrameSet {
  walkDown: string[][][];
  idleDown: string[][][];
  walkUp: string[][][];
  idleUp: string[][][];
  walkRight: string[][][];
}

export interface FloorTilesLoaded {
  type: 'floorTilesLoaded';
  sprites: string[][][];
}

export interface WallTilesLoaded {
  type: 'wallTilesLoaded';
  sets: string[][][][];
}

export interface CarpetTilesLoaded {
  type: 'carpetTilesLoaded';
  sets: string[][][][];
}

export interface SettingsLoaded {
  type: 'settingsLoaded';
  soundEnabled: boolean;
  lastSeenVersion: string;
  extensionVersion: string;
  watchAllSessions: boolean;
  alwaysShowLabels: boolean;
  ghostHeadlessAgents: boolean;
  hooksEnabled: boolean;
  hooksInfoShown: boolean;
  externalAssetDirectories: string[];
  showAreas: boolean;
}

export interface HooksStatus {
  type: 'hooksStatus';
  providerId: string;
  installed: boolean;
}

export interface HooksConsentRequest {
  type: 'hooksConsentRequest';
  providerId: string;
  headline: string;
  disclosure: string;
}

export interface ExternalAssetDirectoriesUpdated {
  type: 'externalAssetDirectoriesUpdated';
  dirs: string[];
}

export interface AreaMappingsLoaded {
  type: 'areaMappingsLoaded';
  mappings: Record<string, string[]>;
}

export interface WorkspaceFolders {
  type: 'workspaceFolders';
  folders: WorkspaceFolder[];
}

export interface WorkspaceFolder {
  name: string;
  path: string;
}

export interface AgentDiagnostics {
  type: 'agentDiagnostics';
  agents: Record<string, any>[];
}

export interface ProjectsLoaded {
  type: 'projectsLoaded';
  projects: Project[];
}

export interface Project {
  id: string;
  name: string;
  repos: ProjectRepo[];
  dir?: string;
  maxReviewRounds?: number;
  accountRoles?: AccountRoles;
  agent?: AgentSettings;
}

export interface ProjectRepo {
  name: string;
  path: string;
  defaultBranch: string;
  setupCommand?: string;
  testCommand?: string;
}

export interface AccountRoles {
  dev?: string;
  qa?: string;
  router?: string;
}

export interface AgentSettings {
  model?: string;
  effort?: EffortLevel;
  thinking?: ThinkingMode;
  permissionMode?: PermissionMode;
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ThinkingMode = 'adaptive' | 'disabled';

export type PermissionMode =
  'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions';

export interface TasksLoaded {
  type: 'tasksLoaded';
  tasks: Task[];
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  branch?: string;
  worktree?: string;
  error?: string;
  createdAt: number;
  agent?: AgentSettings;
  sessionOpen?: boolean;
  prompt?: string;
  summary?: string;
  handoff?: RepoHandoff[];
  stage?: TaskStage;
  maxReviewRounds?: number;
  reviews?: ReviewRecord[];
  reviewUsage?: UsageTotals;
  reviewSessionIds?: string[];
  sessionId?: string;
  parentTaskId?: string;
  readOnly?: boolean;
  accountId?: string;
  reviewAccountId?: string;
  baseCommits?: Record<string, string>;
  usage?: UsageTotals;
  changes?: CodeChanges;
  changedFiles?: ChangedFile[];
}

export type TaskStatus = 'queued' | 'preparing' | 'running' | 'done' | 'failed' | 'stopped';

export interface RepoHandoff {
  repo: string;
  branch: string;
  baseBranch: string;
  repoUrl?: string;
  branchUrl?: string;
  createPrUrl?: string;
  pushCommand: string;
  worktree?: string;
  commits?: number;
}

export type TaskStage =
  | 'review_queued'
  | 'reviewing'
  | 'changes_requested'
  | 'approved'
  | 'escalated'
  | 'ready'
  | 'delivered';

export interface ReviewRecord {
  round: number;
  at: number;
  approved?: boolean;
  summary?: string;
  comments?: ReviewComment[];
  testsRun?: string[];
  error?: string;
}

export interface ReviewComment {
  severity: ReviewSeverity;
  title: string;
  detail: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export type ReviewSeverity = 'blocker' | 'major' | 'minor' | 'nit';

export interface UsageTotals {
  costUsd?: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CodeChanges {
  files: number;
  added: number;
  removed: number;
}

export interface ChangedFile {
  path: string;
  added: number;
  removed: number;
}

export interface PermissionAsked {
  type: 'permissionAsked';
  requestId: string;
  taskId: string;
  taskTitle: string;
  toolName: string;
  detail: string;
  agentId?: number;
  questions?: AgentQuestion[];
}

export interface AgentQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: AgentQuestionOption[];
}

export interface AgentQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface PermissionResolved {
  type: 'permissionResolved';
  requestId: string;
}

export interface ActionError {
  type: 'actionError';
  message: string;
}

export interface AgentDefaultsLoaded {
  type: 'agentDefaultsLoaded';
  defaults: AgentSettings;
  reviewer?: AgentSettings;
}

export interface AgentChat {
  type: 'agentChat';
  id?: number;
  entries: ChatEntry[];
  reset: boolean;
  controllable: boolean;
  taskId?: string;
  reviewer?: boolean;
  usage?: UsageTotals;
}

export interface ChatEntry {
  kind: ChatEntryKind;
  text: string;
  toolName?: string;
  ts?: string;
}

export type ChatEntryKind = 'user' | 'assistant' | 'thinking' | 'tool' | 'toolResult';

export interface FolderPicked {
  type: 'folderPicked';
  requestId: string;
  path?: string;
}

export interface BranchesListed {
  type: 'branchesListed';
  requestId: string;
  repos: RepoBranches[];
}

export interface RepoBranches {
  repo: string;
  branches: string[];
  fetchError?: string;
}

export interface AccountsLoaded {
  type: 'accountsLoaded';
  accounts: Account[];
  roles: AccountRoles;
}

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  masked: string;
  lastTest?: AccountTest;
}

export type AccountKind = 'subscription' | 'apiKey';

export interface AccountTest {
  ok: boolean;
  at: number;
  message?: string;
}

export interface WebviewReady {
  type: 'webviewReady';
}

export interface LaunchAgent {
  type: 'launchAgent';
  folderPath?: string;
  bypassPermissions?: boolean;
}

export interface FocusAgent {
  type: 'focusAgent';
  id: number;
}

export interface CloseAgent {
  type: 'closeAgent';
  id: number;
}

export interface SaveAgentSeats {
  type: 'saveAgentSeats';
  seats: Record<string, SeatAssignment>;
}

export interface SeatAssignment {
  palette: number;
  hueShift: number;
  seatId: string | null;
}

export interface SaveLayout {
  type: 'saveLayout';
  layout: Record<string, any>;
}

export interface SetSoundEnabled {
  type: 'setSoundEnabled';
  enabled: boolean;
}

export interface SetLastSeenVersion {
  type: 'setLastSeenVersion';
  version: string;
}

export interface SetAlwaysShowLabels {
  type: 'setAlwaysShowLabels';
  enabled: boolean;
}

export interface SetGhostHeadlessAgents {
  type: 'setGhostHeadlessAgents';
  enabled: boolean;
}

export interface SetHooksEnabled {
  type: 'setHooksEnabled';
  providerId: string;
  enabled: boolean;
}

export interface HooksConsentResponse {
  type: 'hooksConsentResponse';
  providerId: string;
  choice: HooksConsentChoice;
}

export type HooksConsentChoice = 'install' | 'notNow' | 'never';

export interface SetHooksInfoShown {
  type: 'setHooksInfoShown';
}

export interface SetWatchAllSessions {
  type: 'setWatchAllSessions';
  enabled: boolean;
}

export interface ExportLayout {
  type: 'exportLayout';
}

export interface ImportLayout {
  type: 'importLayout';
}

export interface OpenSessionsFolder {
  type: 'openSessionsFolder';
}

export interface AddExternalAssetDirectory {
  type: 'addExternalAssetDirectory';
  path?: string;
}

export interface RemoveExternalAssetDirectory {
  type: 'removeExternalAssetDirectory';
  path: string;
}

export interface SaveAreaMappings {
  type: 'saveAreaMappings';
  mappings: Record<string, string[]>;
}

export interface SetShowAreas {
  type: 'setShowAreas';
  enabled: boolean;
}

export interface RequestDiagnostics {
  type: 'requestDiagnostics';
}

export interface SaveProject {
  type: 'saveProject';
  project: Project;
}

export interface DeleteProject {
  type: 'deleteProject';
  id: string;
}

export interface StartTask {
  type: 'startTask';
  projectId: string;
  title: string;
  prompt: string;
  agent?: AgentSettings;
  baseBranches?: Record<string, string>;
  fromTaskId?: string;
  branchMode?: BranchMode;
  carryContext?: boolean;
}

export type BranchMode = 'auto' | 'branch' | 'none';

export interface StopTask {
  type: 'stopTask';
  taskId: string;
}

export interface AnswerPermission {
  type: 'answerPermission';
  requestId: string;
  allow: boolean;
  message?: string;
  answers?: Record<string, string>;
  mode?: PermissionMode;
}

export interface SaveAgentDefaults {
  type: 'saveAgentDefaults';
  defaults: AgentSettings;
  reviewer?: AgentSettings;
}

export interface WatchAgentChat {
  type: 'watchAgentChat';
  id?: number;
  taskId?: string;
}

export interface UnwatchAgentChat {
  type: 'unwatchAgentChat';
  id?: number;
  taskId?: string;
}

export interface SendAgentMessage {
  type: 'sendAgentMessage';
  id?: number;
  taskId?: string;
  text: string;
}

export interface InterruptAgent {
  type: 'interruptAgent';
  id?: number;
  taskId?: string;
}

export interface PickFolder {
  type: 'pickFolder';
  requestId: string;
}

export interface ListBranches {
  type: 'listBranches';
  requestId: string;
  projectId: string;
}

export interface SetAgentMode {
  type: 'setAgentMode';
  id?: number;
  taskId?: string;
  mode: PermissionMode;
}

export interface CompleteTask {
  type: 'completeTask';
  taskId: string;
}

export interface SaveAccount {
  type: 'saveAccount';
  id: string;
  name: string;
  kind: AccountKind;
  secret?: string;
}

export interface DeleteAccount {
  type: 'deleteAccount';
  id: string;
}

export interface TestAccount {
  type: 'testAccount';
  id: string;
}

export interface SetAccountRoles {
  type: 'setAccountRoles';
  roles: AccountRoles;
}
