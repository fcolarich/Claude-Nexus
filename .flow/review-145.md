### 1 [global] Unity Workflow Optimization Techniques and UIToolkit Best Practices
id=34f43c31cfa73c5f folded=3 minCos=0.732
HARD(35): UnregisterCallback | RegisterCallback | MonoBehaviours | IVisualElementScheduledItem | ApplyModifiedProperties | GUI.enabled = toggleProp.boolValue | GenericMenu | DrawerState | ComponentUtility.MoveComponentRelativeToComponent | ComponentUtility.CopyComponent | PasteComponentValues | Undo.RecordObject | GC.Collect( | toggleProp.boolValue | io.continis.scriptable-object-tools | GC.Collect | RCP-ui-ux-009 | RCP-ui-ux-025 | RCP-ui-ux-022 | PropertyDrawer | ComponentUtility | MoveComponentRelativeToComponent | MethodInfo | GameObjects | CopyComponent | RecordObject | ScriptableObject | SerializedObject | TrackPropertyValue | RCP | 115 | 118 | 009 | 025 | 022
soft(14): Fran_Unity | field.Bind(secondarySO | field.Bind | Recipes/editor/ordered-bidirectional-property-clamping.md | Recipes/editor/gui-enabled-dependent-section-gate.md | Recipes/ui-ux/multi-field-atomic-update-early-return.md | Recipes/monobehaviours/dirty-flag-try-finally-batch-update.md | Recipes/monobehaviours/deferred-dirty-state-lazy-rebuild.md
MERGED: To poll a VisualElement condition, use `schedule.Execute(action).Until(predicate)` or `.Every(ms)` with an immediate first invoke to avoid flicker; accessing newly added ListView rows requires `listView.schedule.Execute(...).StartingIn(0)`. UI thread scheduling utilizes `TaskScheduler.FromCurrentSynchronizationContext()` and the `System.Reactive` `IScheduler` abstraction, documented in Recipes/editor/uitoolkit-try-un
  ORIG1: Callbacks and One-Shot Event Handling :: To prevent duplicate UIToolkit event callbacks, use `RegisterOnce<T>` (Recipes/editor/uitoolkit-registeronce-one-shot-callback-extension.md), combining `UnregisterCallback` and `RegisterCallback` for idempotency; pair with `ReplaceCallback<T>` for hot-swapping. For PropertyField children in UI Toolk
  ORIG2: UIToolkit Conditional Polling, ListView Access, and UI Thread Scheduling :: To poll a condition on a VisualElement, use `schedule.Execute(action).Until(predicate)`, which stops when the predicate returns true, wrapping the `IVisualElementScheduledItem` pattern; for non-serialized conditional state in UIToolkit drawers, utilize `schedule.Execute(action).Every(ms)` with an im
  ORIG3: Unity Workflow Optimization Techniques :: To clamp ordered float chains in the Inspector, use `BeginChangeCheck/EndChangeCheck` blocks per field and conditionally draw sections with `GUI.enabled = toggleProp.boolValue`, restoring it afterward using a try/finally guard; inter-tick dependencies are declared with `[TickBefore(typeof(X))]` / `[

### 2 [global] Procedural Building Generation Techniques
id=9d2b7d61edbf14ae folded=2 minCos=0.83
HARD(30): u = uEnd | located within the repository at | Recipes/performance/how-do-we-distribute-a-consistent-number-of.md | ran_Unity | ), while programmatic | construction uses | destroying the group with | ObjectField | prop.textureDimension | Texture2D | HideFlags.DontSave | ). Asset duplication uses | ). Asset baking uses | for scene instances and | for tracked paths, deleting companion folders only if | returns zero (file: | ), while safe asset overwrites check existence with | before creating new assets ( | HideFlags.HideAndDontSave | Recipes/serialization/how-do-we-ensure-procedurally-generated-buildings.md | glow1_ADD.mat | Undo.DestroyObjectImmediate | HideFlags | DontSave | DestroyObjectImmediate | DeleteAsset | FindAssets | HideAndDontSave | AnimationIndex | ExitTime
soft(12): Recipes/shaders/how-do-we-uv-map-tiled-wall-textures-along-a.md | Recipes/monobehaviours/random-patrol-reselection-guard.md | Recipes/editor/texture-drawer-typed-object-field.md | Recipes/monobehaviours/local-to-world-waypoints-start.md | Recipes/monobehaviours/segment-index-deterministic-variation-seed.md | Recipes/performance/how-do-we-build-a-mesh-with-a-variable-number-of.md | Recipes/editor/struct-keyed-texture-cache-hideflags-dontsave.md | Recipes/editor/how-do-we-avoid-generating-dozens-of-redundant.md
MERGED: Seamless perimeter wall UV tiling uses `uEnd` carried between quads, mapping U to physical distance * `uvScale` within `BuildingBuilder`, and a capped overlap floor for window distribution consistency; this maintains visual rhythm across varying L/T/H shapes. Deterministic prefab variation selection uses `Random.CreateFromIndex((uint)segmentIndex)` seeded from the segment index. Procedural material coherence selects 
  ORIG1: Seamless Perimeter Wall UV Tiling and Adaptive Window Count :: To achieve seamless perimeter wall UV tiling, the terminal U coordinate (`uEnd`) from each quad is carried forward to the next segment, ensuring a continuous texture strip when unrolled; this `u = uEnd` approach maps U to physical distance multiplied by `uvScale`, as implemented in `BuildingBuilder`
  ORIG2: Procedural Generation and Editor Workflow Recipes :: Deterministic prefab variation selection uses `Random.CreateFromIndex((uint)segmentIndex)` seeded from the segment index to tie variations to geometry position, as documented in `Recipes/monobehaviours/segment-index-deterministic-variation-seed.md`. Procedural material coherence selects a `MaterialP

### 3 [global] Line of Sight, Ground Detection, Projectile Placement & Physics
id=1e5b61560c15afdf folded=2 minCos=0.794
HARD(30): Update* | Physics2DOverlapCompat | Physics2D.OverlapCircle | PreallocNonAllocQueries | CollidesWith | ProjectileBehavior | Hold-to-fire continuous patterns utilize | to prevent stacked streams, with | called on button-down and | SetActive(false | SetActive(true | Snippets/performance/PreallocNonAllocQueries.cs | BP-performance-007 | a.BelongsTo | b.CollidesWith | b.BelongsTo | a.CollidesWith | SpawnBehavior.repeatCount | OverlapCircle | BelongsTo | ScriptableObjects | SpawnBehavior | StopActiveShot | SpawnProjectile | StopProjectile | ParticleSystems | SetActive | 003 | 007 | Fran_Unity
soft(3): Collider[ | Snippets/monobehaviours/Physics2DOverlapCompat.cs | Recipes/monobehaviours/pf-custom-behavior-pool-safety-rules.md
MERGED: Line of sight uses `Physics.Linecast`; missing hits may indicate a lack of colliders or CharacterController usage. Traverse transform hierarchies to handle compound GameObjects by comparing ancestors against the target's root. Prevent self-collisions during LOS raycasts by temporarily setting agent child collider GameObjects to layer 2 (Ignore Raycast) and restoring them using a cached `int[]` array (Recipes/monobeha
  ORIG1: Projectile Placement, Physics, and Pooling Patterns :: Placement validation uses a static helper with an early-return chain (afford → collision → entity overlap → module rules) and cached layer masks computed via `LayerMask.GetMask` (RCP-monobehaviours-042). Snap source/target entity IDs bypass collision rejection (RCP-physics-003). A generic snapping s
  ORIG2: Line of Sight and Ground Detection Raycasting Techniques :: When using Physics.Linecast for line of sight, a missing hit may indicate the target lacks a Collider or uses a CharacterController; to handle compound GameObjects with child colliders, walk up the transform hierarchy comparing ancestors against the target's root. To prevent self-collisions from blo

### 4 [global] Scene Instance, Prefab Handling, State Restoration & Safe Object Destruction
id=2af8535916908579 folded=2 minCos=0.877
HARD(27): GetRootGameObjects( | GameObjects | GetRootGameObjects | LoadSceneAsync(Single | UnloadUnusedAssets( | ObjectPreview.Cleanup( | EditorWindow.OnDestroy( | base.Cleanup( | LoadAssetAtPath || CreateAsset | both in repository | ObjectPreview.Cleanup | base.Cleanup | an_Unityity-workflow-optimization | AssetUsageDetector | RuntimePreviewGenerator | LoadSceneAsync | UnloadUnusedAssets | ObjectPreview | EditorWindow | ScriptableObject | LoadAssetAtPath | CreateAsset | CoInspector | RCP | GUID | 2021.1 | 2021
soft(8): OnDestroy( | Recipes/editor/how-do-you-enumerate-all-root-gameobjects-in.md | Fran_Unity | Recipes/editor/how-do-we-release-procedurally-generated-meshes.md | Destroy( | Recipes/monobehaviours/editor-play-mode-state-restoration.md | EditorWindow.OnDestroy | Recipes/editor/scriptableobject-session-state-scene-guid-key.md
MERGED: {"scene_instance": {"distinguish": ["scene.IsValid()", "scene.isLoaded()"]}, "prefab_reference": {"clone": "HideAndDontSave"}, "asset_vs_scene": {"differentiate": ["EditorUtility.IsPersistent(obj)", "IsSceneObject"]}}, "state_restoration": {"reflection": ["PrefabStageUtility.OpenPrefab(string, GameObject)"]}, "play_mode_override": {"save": "Awake", "key": "#if UNITY_EDITOR", "restore": "OnDestroy", "double_guards": t
  ORIG1: Unity GameObject Destruction, Scene Access, and Safe Object Handling :: Unity destroys child GameObjects before parent cleanup, potentially losing pooled resources; sibling `OnDestroy()` calls are non-deterministic, requiring explicit disposal order within a parent's `Dispose()` method (e.g., Player.OnDispose() → CharacterController.Dispose() → SpeedModel.Dispose()) to 
  ORIG2: Scene Instance, Prefab Handling, State Restoration & Cleanup :: Distinguish scene instances from prefab references by checking `scene.IsValid()` and `scene.isLoaded()`, forcing cloning with `HideAndDontSave` if either fails; use `EditorUtility.IsPersistent(obj)` to differentiate assets from scene-only objects, combined with type checks for `IsSceneObject`. Resto

### 5 [global] Unity Memory: Color Serialization, Float Handling, and Null Safety
id=0fb8eb3d13336626 folded=2 minCos=0.852
HARD(27): BitConverter.GetBytes(float | unsafe | BinaryPrimitives | RCP-ui-ux-019 | BitConverter.GetBytes | BP-performance-001 | GgCore/Gaskellgames | BitConverter | GetBytes | DontDestroyOnLoad | GgCore | MonoBehaviour | EditMode | RCP | NTP | 021 | 019 | 001 | byte)(packed >> shift | Default | SafeMappingType | MappingType | Polarith AI | Debug.Log | power-of-2 | ConsolePro | 008
soft(5): Recipes/ui-ux/epsilon-guarded-float-change-detection.md | is UnityEngine.Object | !((Component)_field | Recipes/serialization/how-do-you-perform-a-null-check-on-a-unity-object.md | C:\ran_Unity\ity-workflow-optimization
MERGED: Color32 values are serialized as `r | (g<<8) | (b<<16) | (a<<24)` and unpacked with byte shifting; SafeBit helper functions (`Set`, `Clear`, `Toggle`, `Write`, `HasFlag`) manage typed bitfields [0, 31]. Color conversions to hex strings use `ColorUtility.TryParseHtmlString` with a `#` prefix guard. Structured console commands append `PREFIX:{JSON}` or `CPAPI:{}`. Linear projects utilize the [Gamma] attribute for gamma
  ORIG1: Float Handling, Serialization, and Null Checks in Unity :: Nullable float3 fields are used in `IComponentData` singletons (BP-dots-ecs-021) within `Snippets/dots-ecs/NullableFloat3Singleton.cs` to represent optional per-frame positional events, eliminating tuples and forcing `.Value` unwrapping while removing null checks; compare `Mathf.Abs(delta) > epsilon
  ORIG2: Color Serialization, Console Logging, Shader Properties & Safe Types :: To serialize a Color32 into a single int field, pack as `r | (g<<8) | (b<<16) | (a<<24)`, unpacking each byte lane with `(byte)(packed >> shift)` for platform-safe endianness; this avoids four separate byte fields (RCP-serialization-008, RCP-editor, RCP-monobehaviours). For storing and manipulating 

### 6 [global] Shader Optimization and Rendering Techniques
id=57c37c0ca9eada06 folded=3 minCos=0.769
HARD(25): MakeKey | uniform half | HasProperty | HasFloat | StyledCategory | StyledBanner | StyledMessage | UnityExceptions | BOXOPHOBIC | HLSL | ClearFlags.Depth + GL.Clear(true, true, bg | TextureFormat.RGBA32 | RGB24 | Apply(false, markNonReadable=true | RuntimePreviewGenerator | backgroundColor.a | ClearFlags.Depth | GL.Clear | ClearFlags | TextureFormat | URP | SMAA | FXAA | 4.59 | 0.8
soft(4): Fran_Unity | C: ran_Unity | Recipes/editor/material-hasproperty-guard-before-get.md | ClearFlags.Color
MERGED: Amortize trigonometric costs for cubemap rotation using Rodrigues formula `(yAxis + xzPlane*cos + cross(Y_UP,xzPlane)*sin)` in the vertex shader (Recipes/shaders/cubemap-rotation-rodrigues-vertex.md); avoid per-fragment calculations. Correct vertical stretch for orthographic cameras by multiplying vertex Y with `lerp(1.0, unity_OrthoParams.y/unity_OrthoParams.x, unity_OrthoParams.w)` (Recipes/shaders/cubemap-ortho-y-
  ORIG1: Cubemap Rotation, Orthographic Correction, and Geometry Shader Vertex Alpha Extrusion :: To amortize trigonometric costs, cubemap sample direction rotation is moved to the vertex shader using Rodrigues formula: `(yAxis + xzPlane*cos + cross(Y_UP,xzPlane)*sin)`, as documented in Recipes/shaders/cubemap-rotation-rodrigues-vertex.md; this avoids per-fragment calculations. For orthographic 
  ORIG2: Shader Optimization, World Position Mapping, Global Constants & Zero-Cost Properties :: To reduce GPU register pressure, declare non-positional CBUFFER uniforms as half precision (Recipes/shaders/half-precision-cbuffer-non-positional.md). Suppress the _ST uniform and tiling UI for textures without UV tiling by using the [NoScaleOffset] property on cubemap and screen-space textures (Rec
  ORIG3: HDR Cubemap Decoding, Color Saturation, and URP Sprite Rendering :: To correctly decode HDR cubemaps, declare a `[HideInInspector] Vector _Tex_HDR` alongside each CUBE texture in the shader; Unity writes decoding instructions during import which should be passed to the `DecodeHDR(sample, _Tex_HDR)` function before tinting or exposure multiplication. When blending HD

### 7 [global] Unity Editor Tooling and Settings Persistence
id=ae03b5288dd47c61 folded=3 minCos=0.782
HARD(24): InternalEditorUtility.SaveToSerializedFileAndForget | LoadSerializedFileAndForget | in repository | CodeStage/Maintainer | InternalEditorUtility | SaveToSerializedFileAndForget | CodeStage | EditorStyle | Lazy<GUIStyle> | Lazy<GUIStyle>(factory | AssetImporterEditor.ResetValues( | DiscardChanges( | #if UNITY_2022_2_OR_NEWER | AssetImporterEditor.ResetValues | AssetImporterEditor | ResetValues | DiscardChanges | CoInspector | RCP | 2022.2 | 077 | 2022 | IntoTheEndlessSea | 029
soft(10): Knowledge/editor.md#BP-editor-034 | Knowledge/editor/scriptablesingleton-project-settings-need.md | ran_Unityity-workflow-optimization | Recipes/editor/inspector-pro-personal-skin-adaptation.md | Recipes/editor/lazy-editor-resources-skin-aware.md | Recipes/editor/how-do-you-create-and-cache-a-set-of-custom-imgui.md | UNITY_2022_2_OR_NEWER | Recipes/editor/enum-drawer-options-from-text-asset.md
MERGED: Custom editor panels use `[SettingsProvider]` attribute with `SettingsScope.User` or `SettingsScope.Project` (BP-editor-034). Project settings persist to `ProjectSettings/<tool>.asset`; personal settings are in `UserSettings/` (Unity 2020.1+) or `Library/` (older versions, gitignored). `ScriptableSingleton<T>` with `[FilePath]` requires implementing `EditorApplication.quitting` and `playModeStateChanged` to call `Sav
  ORIG1: Unity Editor Settings Persistence and Provider Integration :: To create custom Preferences or Project Settings panels, decorate a static method returning `SettingsProvider` with the `[SettingsProvider]` attribute, specifying `SettingsScope.User` or `SettingsScope.Project`; this ensures discoverability (BP-editor-034). When using `ScriptableSingleton<T>` with t
  ORIG2: Editor UI Style Management and Resource Loading :: Adapt custom editor UI elements for Pro/Personal skins by checking `EditorGUIUtility.isProSkin` and swapping colors using `ColorUtility.ToHtmlStringRGB`. Store adaptation recipes in Recipes/editor/inspector-pro-personal-skin-adaptation.md, Recipes/editor/lazy-editor-resources-skin-aware.md, and Reci
  ORIG3: Editor Tooling Techniques :: MaterialPropertyDrawer loads space-separated LabelIndex pairs from a TextAsset at draw time (Recipes/editor/enum-drawer-options-from-text-asset.md), caching results in a static dictionary keyed by path; Resources-relative string fields use a custom PropertyAttribute and drawer, converting AssetDatab

### 8 [global] HDRP Workflow Optimization & Cosmetic Fog Migration
id=31a733d6ddc7e686 folded=2 minCos=0.801
HARD(21): manifest.json | GraphicsSettings.m_CustomRenderPipeline | UnityEngine.Rendering.Universal | TreeFogManager.cs | design.md | architecture.md | GraphicsSettings | RenderGraph | ScriptableRendererFeature | FullscreenCustomLightingFeature | UnityEngine | LocalVolumetricFogMaskMode | TreeFogManager | ShaderGraphAlpha | ForestDensityProvider | CosmeticFogStore | FogMaskCompositor | FogMaskWindow | UpdateTreeFogWorldEditingCommandLogic | URP | 292
soft(6): LocalVolumetricFogMaskMode.Material | impl-spec.md | tasks.json | CustomPass/FogMaskCompositor | C:\Fran_Unity\unity-workflow-optimization | Fran_Unity
MERGED: For HDRP temporal effects using CustomPasses, allocate two RTHandles in `Setup()`, render to a temporary RTHandle in `Execute()`, composite with history via material, copy back into the history RTHandle using `Graphics.CopyTexture`, and release in `Cleanup()` (Recipes/vfx/hdrp-custompass-rthandle-temporal-buffering.md, C: ran_Unityity-workflow-optimization); dynamic shadow distance adjustment based on camera zoom inv
  ORIG1: Lands of Old Cosmetic Fog System Migration to HDRP :: The Lands of Old project uses HDRP version 17.3.0 (manifest.json; GraphicsSettings.m_CustomRenderPipeline guid b22c03f44b62c994bb2f40fd8650d727 = Assets/_Project/Lands of Old/Config/HDRP/HDRP.asset) and cannot use URP-only fog assets like INab Better Fog (URP RenderGraph ScriptableRendererFeature) o
  ORIG2: HDRP CustomPass Temporal Buffering, Dynamic Shadow Distance, LineRenderer Beam Tiling, Projector Matrix Shadows, Materia :: For HDRP temporal effects using a CustomPass, allocate two RTHandles in `Setup()`, render to a temporary RTHandle in `Execute()`, composite with history via material, copy back into the history RTHandle using `Graphics.CopyTexture`, and release in `Cleanup()` – this originates from `Recipes/vfx/hdrp

### 9 [global] GPU Data Streaming and Memory Management Techniques
id=267608a77af63102 folded=2 minCos=0.858
HARD(21): _pendingFill | committedData | previewData | isDirty | AddChange( | ResetPreview( | CommitPreview( | PerRendererData | UnityPerMaterial | GUILayoutOption | Dictionary<int, GUIContent> | Dictionary<GameObject, Dictionary<Type, Component>> | GameObjects | AddChange | ResetPreview | BlockCopy | CommitPreview | MaterialPropertyBlocks | MinWidth | TryGetValue | IMGUI
soft(3): C:	ran_Unity
ity-workflow-optimization | C: \ran_Unity\ity-workflow-optimization | Buffer.BlockCopy
MERGED: To stream CPU data to a ComputeBuffer/GraphicsBuffer each frame without stale data or double submissions, use a `List<T>` accumulator and upload via `SetData` in `Tick()`, documented in `Recipes/gpu/frame-buffered-computebuffer-streaming.md` (C:\ran_Unity\ity-workflow-optimization), originating from `lands-of-old-runtime`; for ECS job integration, schedule buffer fills at the end of frame N and complete them at the s
  ORIG1: Frame-Buffered ComputeBuffer/GraphicsBuffer Streaming Techniques :: To stream CPU-generated structured data to a ComputeBuffer each frame without stale data or double submissions, maintain a `List<T>` accumulator and upload via `SetData` in `Tick()`, setting the shader count then clearing it; this approach is documented in `Recipes/gpu/frame-buffered-computebuffer-s
  ORIG2: Performance and Memory Management Techniques :: To prevent stale vertex/index data corruption during mesh staging, a `MeshStagingTryFinally` (BP-performance-008) mechanism with try-finally cleanup is implemented in `Snippets/performance/MeshStagingTryFinally.cs`, alongside a `ListPool<T>` facilitated by `ListPoolMultiStage` (BP-performance-009) f

### 10 [global] Camera Space Calculations, Restoration & Scene View Management
id=41623c787262b9a3 folded=3 minCos=0.702
HARD(17): in the | causes clamping, while | results in gentle following; see | AABB | WASD | Y-_FogPosition | AERO | 1.0 | 0.9999 | 0.001 | 0.00001 | 0.0 | 9999 | 001 | 00001 | I_VP | RuntimePreviewGenerator
soft(6): repository. A distance-ratio lerp camera catch-up uses | Recipes/monobehaviours/distance-ratio-lerp-camera-catchup.md | unity_FogColor | Recipes/shaders/skybox-fog-branchless-lerp-chain.md | Recipes/shaders/my-anisotropy-slider-darkens-the-fog-and-needs-a.md | Recipes/shaders/my-volumetric-self-shadow-is-a-nested-raymarch.md
MERGED: To compute a tighter bounding volume for rotated objects in camera space, rotate eight corners of local bounds using `Quaternion.Inverse(cameraRotation)` and reconstruct a world-space Bounds; this achieves approximately 41% tighter framing (Recipes/editor/how-do-you-compute-a-tighter-bounding-volume-for.md, C:\Fran_Unity\unity-workflow-optimization). For precision-safe world-space ray reconstruction, multiply I_P the
  ORIG1: Camera Management and Restoration Techniques :: To restore a borrowed camera's clip planes without corruption, verify `savedNear < camera.farClipPlane` and assign near/far values to avoid Unity’s internal clamping; see `Recipes/editor/how-do-you-restore-a-borrowed-cameras-clip-planes.md` in the `C: ran_Unity ity-workflow-optimization` repository.
  ORIG2: Volumetric Fog Optimization Techniques :: A five-step branchless fog mask uses abs(Y-_FogPosition) remapped and saturated, then raised to a softness power, lerped for fill, lerped again for intensity, blending unity_FogColor into the cubemap color (Recipes/shaders/skybox-fog-branchless-lerp-chain.md). To prevent an anisotropy slider from da
  ORIG3: Camera-Space AABB & Precision-Safe World-Space Ray Recipe :: To compute a tighter bounding volume for rotated objects in camera space, rotate all eight corners of each renderer's local bounds into camera space using Quaternion.Inverse(cameraRotation), then track the minimum and maximum values per axis to reconstruct a world-space Bounds, achieving approximate

### 11 [C--Fran-Voodoo-Magic] Boot Sequence and Loading Flow
id=d204b3799beb92b7 folded=2 minCos=0.787
HARD(16): persistent_object | persistence_method | ADR-002 | ServiceContainer/PlayerState/EventCatalog | failure_policy | DontDestroyOnLoad | ServiceContainer | PlayerState | EventCatalog | GrimoireView | EsotericLineView | BackgroundDistortionView | EventUnlockView | ADR | 999 | 002
soft(6): session_contents | error_handling | missing_view_behavior | mock_requirement | splash_view_missing_behavior | deferred_views
MERGED: The boot scene (index 0, sortingOrder 1000) lacks an EventSystem component due to its non-interactive nature; the sequence is Studio -> Intermediary (empty RectTransform + CanvasGroup) -> Game, controlled by independent fade animations via CanvasGroup levers. The loading view, implementing ILoadingView and parented to BootLoader, uses DOTween DOFillAmount 0.3s OutQuad unscaled animation and requires bar.Complete() be
  ORIG1: Boot scene contains no EventSystem :: The Boot scene does not have an EventSystem component, as it is non-interactive and only used for loading/presentation during the boot phase.
  ORIG2: Boot Sequence & Loading Flow with Graceful Failure Handling :: { "boot_splash_sequence": ["Studio", "Intermediary" (empty RectTransform + CanvasGroup), "Game"], "animation_control": "independent fade animations via CanvasGroup levers", "loading_view": {"class": "ILoadingView", "parent": "BootLoader", "animation": "DOTween DOFillAmount 0.3s OutQuad unscaled", "r

### 12 [C--Voodoo-Paper2] Character Selection, Respawning, Game Abandonment, and Mode Switching
id=abecf06c659eb915 folded=2 minCos=0.896
HARD(15): GameStartedAllModes | GameFinishedAllModes | RevivePopupOpened | HomeController.OnPlayClicked | WorldFlowController.StartGame | LocalPlayerScore | MatchesPlayed | LastEventToRedeem | JustPlayed | WonLastMatch | HomeController | OnPlayClicked | WorldFlowController | StartGame | RespawnPlayer
MERGED: Selecting a character via `CharactersManager.SelectCharacter()` triggers re-entrancy; `SetCurrentSkin()` calls `CharacterSelected` with an outdated model, requiring data correction. Same-session respawns after character switching fail to reinitialize `CharacterController` and `SkinViewConfig`, causing stale states and missing UI elements alongside Addressables reference count races. The shared static field `_ignoreRe
  ORIG1: Game Abandonment, Mode Switching, and Crash Mitigation :: The shared static field `_ignoreReviveRequirement` was aliased with an internal GameAbandonmentController one-shot protocol flag; lifecycle event handlers (triggered by `GameStartedAllModes`, `GameFinishedAllModes`, or `RevivePopupOpened`) inadvertently reset the debug persistent flag. This is resol
  ORIG2: Character Selection & Respawning Issues :: Selecting a character via `CharactersManager.SelectCharacter()` triggers a double-fire of events: `SetCurrentSkin()` calls `CharacterSelected` with an outdated model, followed by data correction, indicating re-entrancy issues and contributing to timing misalignment during character/skin swaps; subse

### 13 [C--Fran-LLM-Knowledge-Base] Persistent Code Knowledge System - LLM Zettelkasten
id=78ac33af6e6ce409 folded=2 minCos=0.817
HARD(14): L1/L3 | Continue.dev | CLAUDE.md | memory/state.json | DeusData | RepoMap | PageRank | LogicLens | MCP | RAG | JVM | CLAUDE | 99.2 | C:   estepo
MERGED: {"L1_structural_facts": "GitNexus (Tree-sitter AST + KuzuDB graph, supporting TypeScript and Python) supports 12 languages.", "L3_feature_maps": "Generated using Leiden algorithm and BM25 hybrid search.", "L2_LLM_summaries": "Extends GitNexus with LLM summaries and confidence scores.", "L4_method_prose": "Enriched with self-validation questions stored in a SQLite database indexed by FTS5.", "gitnexus_config": {"path"
  ORIG1: Tool Landscape Survey (March 2026) :: - **GitNexus** — Tree-sitter AST + KuzuDB graph, 12 langs, MCP tools, community/process detection. L1/L3 foundation. - **Codebase Memory MCP** (DeusData) — Similar concept, Go binary, 64 langs, 99.2% token reduction. No LLM enrichment, no execution flows. - **Code-Graph-RAG** (Memgraph) — Tree-sitte
  ORIG2: LLM Knowledge Base Project - Consolidated Memory :: The LLM Knowledge Base project builds a persistent code knowledge system ("LLM Zettelkasten") as an overlay (Approach B) on GitNexus, which provides L1 (AST structural facts) and L3 (feature maps, call chains, communities). Our system adds L2 (LLM summaries with confidence) and L4 (method prose + se

### 14 [global] UI Event Handling and Blocking
id=d8b3e1e7b4cd944c folded=2 minCos=0.869
HARD(14): ). The new Input System uses | for input resolution; the | where | Input.GetMouseButtonDown | TheGame.IsMobile | colonist_selected | EventTrigger | GetMouseButtonDown | TheGame | IsMobile | IsSelectionBox | within the repository at | The file path for the UI blocking detection recipe is | while the click consumption recipe resides at
soft(1): order_click
MERGED: Cache `PointerEventData` using the null-coalescing operator (`??=`), acquire a `ListPool<RaycastResult>` before `RaycastAll`, check for hits against the `UILayer` within a try block, and release the list in a finally block—originating from `lands-of-old-runtime`; UI blocking detection is documented in `Recipes/ui-ux/eventsystem-raycastall-listpool-ui-blocking.md` at repository `C:‫ran_Unity ity-workflow-optimization`
  ORIG1: UI Dragging, Click Detection, and Input Handling :: Dragging UI elements requires dividing the pointer delta by `scaleFactor` before updating anchoredPosition. Unity’s `EventSystem` tracks drag origin from the initial target element; `EndDrag` fires on that original target even with overlapping elements. Use `Event.current.rawType` to reliably detect
  ORIG2: UI Blocking Detection and Click Consumption :: To detect UI blocking without per-frame allocations, cache `PointerEventData` using the null-coalescing operator (`??=`), acquire a `ListPool<RaycastResult>` before calling `RaycastAll`, check for hits against the `UILayer` within a try block, and release the list in a finally block; this approach o

### 15 [global] Unity Reflection & API Detection Strategies
id=d12d92a39d3a7889 folded=3 minCos=0.802
HARD(13): ReflectionTypeLoadException | SizeSelectionCallback | selectedSizeIndex | repo: | (.Result freezes thread), | (disposed throws), | GetTypes | InvalidCastException | NamedBuildTargets | CoInspector | URP | HDRP | LINQ
soft(7): assembly.GetTypes( | ) skips | assembly.GetTypes | Fran_Unity | Tools.hidden | Assembly.GetTypes( | Assembly.GetTypes
MERGED: To detect the active Unity render pipeline, inspect `GraphicsSettings.defaultRenderPipeline's Type().ToString()` for substrings "Universal" or "HD", falling back to `QualitySettings.renderPipeline`; detailed in Recipes/editor/pipeline-detection-type-name-inspection.md. Optional packages are detected using `Type.GetType("FullTypeName, AssemblyName")` within an `[InitializeOnLoad]` context and applied as define symbols
  ORIG1: Unity API Lookup & Reflection Fallback :: The Unity API MCP does not index collection types like `UnsafeList<T>` and `DynamicBuffer<T>`, requiring codebase searches (particularly in `Packages/`) using grep patterns such as `'UnsafeList.*AddRange|IsCreated|Ptr'` to determine their API surface; project codebase verification is preferred over 
  ORIG2: Detecting Unity Pipeline, Optional Packages, and Active Tools via String Inspection :: GraphicsSettings.defaultRenderPipeline's Type().ToString() is inspected for substrings "Universal" or "HD", falling back to QualitySettings.renderPipeline to detect the active render pipeline without hard URP/HDRP assembly references; this logic resides in Recipes/editor/pipeline-detection-type-name
  ORIG3: Editor Package Management and Optimization :: To detect optional packages without reflection errors, use `AssetDatabase.FindAssets("t:ConfigTypeName")`.Length > 0 and cache the result in a nullable boolean field to avoid repeated database scans; this is documented in BP-editor-032 at C:\Fran\_Unity\unity-workflow-optimization\Knowledge/editor.m

### 16 [C--Fran-LLM-Workflow-Optimization] Qwen3.6-27B Agentic Routing and Nexus v2.1 Configuration
id=7bb382d34cd0b559 folded=2 minCos=0.847
HARD(12): claude -p haiku | Q4_K_M | SessionEnd/Stop/PreCompact | strip_prose | SessionEnd | PreCompact | JSON | 0.6 | 0.8 | 0.9 | 107 | LangGraph
soft(2): call_local | extraction_models.yaml
MERGED: Qwen3.6-27B agentic task performance improves to 65.4% compared to Qwen3.5-27B's 51.6%, specifically in routing, clarification, and classification nodes; it incorporates a native context of 262K (increased from ~32K). Deploying the routing-layer Qwen model with the llama.cpp MTP drafter flag yields a 1.71× performance gain via AnythingLLM; use this flag during tuning or deployment. Model routing defaults to Haiku 4.5
  ORIG1: Claude Nexus v2.1 Architecture & Configuration :: Model routing: Haiku 4.5 default (MCP), Qwen 3.6-27B opt-in (--use-qwen flag/UI toggle for routing/review/critic); task allocation—Sonnet 4.6 (implementation), Opus 4.7 (spec), Gemini 2.5 Flash (web research). Hardware: Qwen Q4_K_M 16.8GB via llama.cpp or LM Studio (not Ollama). Claude Code primary 
  ORIG2: Qwen3.6-27B Agentic Routing Performance and Optimization :: Qwen3.6-27B demonstrates a significant improvement over Qwen3.5-27B on agentic task benchmarks, achieving 65.4% compared to 51.6%, particularly benefiting routing, clarification, and classification nodes; this model also incorporates 262K native context, an increase from ~32K in Qwen3.5-27B, which i

### 17 [C--Voodoo-Paper2-clean-diagnostics] Zone Pairing and Retry Strategy Optimization
id=bf08982a26beaba7 folded=2 minCos=0.823
HARD(12): pairingAttempt == 0 || pairingAttempt >= 2 | GenericZone.cs | AssetDatabase.FindAssets | GenericZone | LoopClosureFixtures | AssetDatabase | FindAssets | TryPairingRealGain | TryPairingDifferenceGain | InsufficientGainAfterMerge_07 | _12 | all-4-failed
soft(2): _documents/loop-closure-orientation-research.md | Assets/_Paper2/Editor/Tests/Data/LoopClosureFixtures
MERGED: Long-arc retries (attempt2/attempt3) generate candidate zones spanning 130-207 points, compared to attempt1's 20-40, requiring unconditional application of the Difference trim across all attempts; `AnchorReconnectThresholdSq` in CutOtherZonesSystem was increased from 0.5 to 2.0 units to prevent anchor drift and defaults player variant selection to FIXED (variant=1) due to the high cost of joint evaluation (JOINT_BIG/
  ORIG1: Zone Pairing and Reconnection Strategy Changes :: Long-arc retries (attempt2/attempt3) generate candidate zones spanning 130-207 points, compared to attempt1's 20-40, necessitating unconditional application of the Difference trim across all attempts; `AnchorReconnectThresholdSq` in CutOtherZonesSystem was increased from 0.5 to 2.0 units to prevent 
  ORIG2: Retry Chain Optimization and Loop Closure Gain Metric :: Lazy building of long arc candidates (`longLeft`, `longRight`) in retry attempts 2-4 avoids build cost when the first attempt succeeds, enabling a low-risk fallback without performance penalty; this is crucial because retry attempts are used 0–3 times per hundreds of real closures and zero times acr

### 18 [C--Voodoo-Paper2] Quantum Service Lifecycle Resume Race & GameplayController Crash Root Cause
id=0648ff1773b9d153 folded=2 minCos=0.774
HARD(11): UniTask.WaitUntil | ServiceNotFound | UniTask | WaitUntil | CachedService | TeamBattle | 97.8 | 2.2 | 484 | 177 | 178
soft(1): Party/TeamBattle
MERGED: Crash analysis indicates a median gap of ~4 seconds and a maximum of ~69 seconds between last activity and crash, consistently occurring in processState: BACKGROUND; this suggests a race condition, not user-idle behavior. The Quantum Service Lifecycle resume race involves OnApplicationPause(false) fast-forwarding the simulation, triggering multiple OnPlayerDeath events and racing with EnemyTrainCarsPool re-registrati
  ORIG1: BACKGROUND crashes show tight 4s median gap, consistent with race not user-idle :: Corrected gap analysis (median ~4s, max ~69s) from last activity to crash. Tight window consistent with genuine race condition, not phone backgrounded in pocket for extended period. All 80 crashes are processState: BACKGROUND.
  ORIG2: Quantum Service Lifecycle Resume Race Analysis & GameplayController Crash Root Cause :: OnApplicationPause(false) synchronously fast-forwards Quantum simulation, triggering multiple OnPlayerDeath events and racing with EnemyTrainCarsPool re-registration or Party Mode teardown, causing 'not found' crashes on iOS and Android; Android crashes show 94% FOREGROUND while iOS shows ~100% BACK

### 19 [C--Fran-Voodoo-Magic] URP Volume Stack Optimization and DramaEventPunch Cost
id=e57c1525841e8853 folded=2 minCos=0.813
HARD(11): DOVirtual.EasedValue | DDR-001 | UpdateEventPunch | EasedValue | DefaultVolumeProfile | SceneBackground | YAML | FXAA | SSAO | DDR | 001
MERGED: DramaEventPunch volume weight is 0 except during the punch event, costing only during its brief flare (intensity 55, iteration count 8). Steady-state bloom cost comprises SceneProfile and DramaAmbient; the punch is not an optimization target. URP blends active Volumes into a single interpolated stack with negligible CPU overhead for parameter blending; GPU cost equals one volume with blended final bloom values. The s
  ORIG1: DramaEventPunch not steady-state cost :: DramaEventPunch volume weight is 0 except during the punch event, so its high intensity (55) and iteration count (8) only cost during the brief flare, not continuously. Steady-state bloom cost is SceneProfile (always on) + DramaAmbient (continuously breathing). The punch is not an optimization targe
  ORIG2: URP Volume Stack Optimization & Asset-Immutable Configuration :: URP blends active Volumes into a single interpolated stack (GPU cost equals one volume with blended final bloom values: iterations × intensity × resolution). CPU overhead for parameter blending is negligible. The scene uses unlit SpriteRenderers, no scene lights, and a panning camera; mobile GPU cos

### 20 [global] Event Subscription Lifecycle Management & Deferred Initialization
id=eede6014fc052da6 folded=2 minCos=0.898
HARD(11): C:	ran_Unity
ity-workflow-optimization | ran_Unity | UiViews | SceneVisibilityManager | EditorApplication.contextualPropertyMenu | InitializeOnLoadMethod | OnModelUpdated | ShutDown | ItemViewCreated | ItemViewDestroyed | EditorApplication
soft(5): Recipes/ui-ux/lazy-uiviewcollection-nullcoalescing-assignment.md | Recipes/editor/lazy-guistyle-deferred-initialization.md | Recipes/ui-ux/uiview-generic-model-binding-listener-lifecycle.md | OnModelUpdated/OnModelChanged | Awake/OnDestroy
MERGED: Deferred initialization of `UiViewCollection` uses the null coalescing assignment operator (`??=`) within `OnModelChanged`, triggering `RebuildItemViews()` and ensuring `_collection?.OnDestroy()` is called during cleanup. GUIStyle fields are lazily initialized as static readonly `Lazy<GUIStyle>` to avoid `NullReferenceException`. Generic model binding on a `UiView` caches a single delegate field for listener lifecycl
  ORIG1: Deferred Initialization and Model Binding for UiViews :: To defer `UiViewCollection` construction until a model is bound, use the null coalescing assignment operator (`??=`) within the `OnModelChanged` method to create the collection only once on first binding, then call `RebuildItemViews()` on subsequent updates (file: Recipes/ui-ux/lazy-uiviewcollection
  ORIG2: Event Subscription Lifecycle Management :: Lazily initialize dynamic UiViewCollection using the ??= operator or null check within OnModelUpdated/OnModelChanged, triggering RebuildItemViews() on subsequent updates and ensuring _collection?.OnDestroy() is called during cleanup. Subscribe to events in Initialize() with named handlers and unsubs

### 21 [C--Fran-LLM-Workflow-Optimization] add_proposal Script Behavior and Batch Processing Considerations
id=ad5376b1e3533d87 folded=2 minCos=0.874
HARD(11): DELETE + commit( | SELECT COUNT(*) FROM proposals | DELETE | SELECT | COUNT | FROM | JSON | 032 | 033 | 923 | CLI
MERGED: The `add_proposal` script's `--update` mode uses `args.<field>` for record construction, requiring wiring of new updatable fields in create and update code paths to prevent silent drops; updates should use `/update-tooling-reference`. Partial updates must preserve unchanged fields; `add_proposal.py:149` demonstrates that `record.get('field', '')` can erase absent fields like 'body', requiring presence checks or prese
  ORIG1: add_proposal Batch Transaction Atomicity, Empty Proposal Generation & Backfill Strategy :: The `add_proposal` function (used in batch operations tasks 032/033) previously broke transaction atomicity by internally managing transactions with `BEGIN IMMEDIATE`/`COMMIT`, conflicting with caller-supplied connections and `BEGIN IMMEDIATE` transactions; this was due to using `DELETE + commit()` 
  ORIG2: add_proposal --update Field Wiring and Partial Updates :: The `add_proposal` script’s `--update` mode builds records from explicitly-wired fields using the `args.<field>` format; missing field wiring results in silent record drops, necessitating wiring for new updatable fields in both create and update code paths. Proposal updates should be performed via t

### 22 [global] Pooled Resources, Music Transitions, and FileSystemWatcher Optimization
id=888a3d69fe96f7fe folded=3 minCos=0.714
HARD(10): This approach applies to projects within | originating from | ran_Unity | respectively, all within the repository at | within the | TryPop | Count < MaxPoolSize | Fran_Unity | MaxPoolSize | FSW
soft(5): Play( | Recipes/monobehaviours/hysteresis-bgm-state-machine.md | Recipes/monobehaviours/beat-quantised-music-transition-bar-boundary.md | Recipes/dots-ecs/timestamp-jitter-audio-throttle.md | C:\Fran_Unity\unity-workflow-optimization
MERGED: Maintain separate free and busy lists for AudioSources; reclaim busy AudioSources by polling `isPlaying` in `Update()` or reverse-iterating the busy list upon removal (Recipes/monobehaviours/audiosource-pool-late-removal.md). For single-clip intro+loop music, use one `AudioClip`, disable looping (`loop = false`), and seek `audioSource.time` to the loop start time using a coroutine that checks per frame when the curso
  ORIG1: AudioSource Pooling and Recycling with Deferred Completion :: To pool AudioSources, maintain separate free and busy lists; reclaim busy AudioSources by polling `isPlaying` in `Update()` or reverse-iterating the busy list upon removal, as described in `Recipes/monobehaviours/audiosource-pool-late-removal.md`. For single-clip intro+loop music, use one `AudioClip
  ORIG2: Music Layer State Transitions, Beat Quantization, and Timestamp Throttling :: To implement hysteresis state transitions for music layers (RCP-monobehaviours-002), enter the combat state when a count reaches or exceeds a threshold and exit when the count is zero; timestamp gating should be used to control intro layer duration. Music transitions should be beat-quantized by comp
  ORIG3: DictionaryPool & Buffer Pool Usage Patterns :: For hot-path UI panel updates, use `using var _ = DictionaryPool<string,object>.Get(out var args)` within the `EnabledTick()` function to avoid per-frame heap allocation of localized format arguments; the pool automatically reclaims resources upon block exit, originating from `lands-of-old-runtime` 

### 23 [global] SerializedProperty Handling and Traversal
id=1ad0bc5328b3e96b folded=2 minCos=0.836
HARD(10): AnnotationUtility.showSelectionOutline | PropertyInfo | ). Handle all | values including | ). For safe initialization of | AnnotationUtility | CoInspector | startDepth+1 | GetArrayElementAtIndex | isArray+String
soft(5): property.isArray && propertyType != String | property.isArray | Recipes/editor/annotation-utility-showselectionoutline-reflection.md | Array.data[N | Array.data
MERGED: Iterating `SerializedProperty` with `GetIterator() + Next(true)` requires filtering propertyPath to exclude "m_CorrespondingSourceObject", "m_PrefabInstance", or "m_PrefabAsset" for accurate asset reference checks, and uses `IsRealArray()` (Snippets/editor/SerializedPropertyIsRealArray.cs) to identify real arrays; all `SerializedPropertyType` values are handled via a switch statement with cached `MethodInfo` (Recipes
  ORIG1: SerializedProperty Handling, Asset Saving, and Scene Reference Auto-Wiring :: Iterating `SerializedProperty` using `GetIterator() + Next(true)` requires filtering propertyPath to exclude "m_CorrespondingSourceObject", "m_PrefabInstance", or "m_PrefabAsset" to avoid false positives during asset reference checks; these are Unity-internal prefab linkage properties. To determine 
  ORIG2: SerializedProperty Tree Traversal and Property Accessor Recipe :: The `PropertyAccessor` (UltEvents/Serialization.cs, Recipes/editor/property-accessor-reflection-path-traversal.md) caches reflection paths using a `Dictionary<Type, Dictionary<string, PropertyAccessor>>`, parsing nested dots and `.Array.data[N]` segments; `ArrayPropertyAccessor` handles indexing for

### 24 [C--Fran-IntoTheEndlessSea] ECS System Ordering, Query Disposal, Deferred Entity Removal
id=0827f1f0b800f671 folded=2 minCos=0.831
HARD(10): PlayerLoadoutManager.ConvertToScrap | EntityManager.SetComponentData | BP-dots-ecs-007 | DontDestroyOnLoad | PlayerLoadoutManager | ConvertToScrap | EntityManager | SetComponentData | DDOL | 007
soft(1): EntityQuery.Dispose(
MERGED: AutoCollectSystem must declare `[UpdateAfter(typeof(PickupProximitySystem))]` and include `.WithDisabled<PickupTag>()` in the second loop sweeping `PendingPickupTag` entities to prevent ordering hazards; subsequent systems use `.WithNone<PreviousStateTag>` filters. Dispose of an `EntityQuery` only if `world != null && world.IsCreated`, using a flag like `_queriesReady`. Verify `_scrapQuery.IsCreated && World.IsCreate
  ORIG1: ECS World Liveness, Query Disposal, and Deferred Entity Removal :: During shutdown, `World.DefaultGameObjectInjectionWorld` is destroyed before `MonoBehaviour.OnDestroy()`. Dispose of an `EntityQuery` only if `world != null && world.IsCreated`; `EntityQuery.Dispose()` is unconditionally safe. Use a separate flag (e.g., `_queriesReady`) for conditional disposal. Wit
  ORIG2: AutoCollectSystem Ordering & Transition Handling :: AutoCollectSystem must declare `[UpdateAfter(typeof(PickupProximitySystem))]` to prevent ordering hazards; the second loop sweeping `PendingPickupTag` entities must include `.WithDisabled<PickupTag>()` to avoid matching entities during transition. To prevent reprocessing in multi-system item transit

### 25 [global] Git Repository Recovery and Refetching
id=c41f8cb084ac187e folded=2 minCos=0.827
HARD(9): git push | git pull | git count-objects -v | git status | git blame | bisect | rebase | git ls-remote --heads origin | HEAD
soft(2): git update-ref refs/remotes/origin/<branch> <commit> | git fetch --depth 1 origin <branch>
MERGED: Interrupted `git fetch` operations can corrupt the local object store, rendering `git gc --aggressive` and `git prune` ineffective. `git fetch --refetch origin` resolves 'pack has N unresolved deltas' or 'invalid index-pack output' errors, bypassing corruption when thin packs cannot resolve due to missing blob objects; `git --refetch` (Git 2.42+) forces a full refetch without local delta bases. Repeated identical unr
  ORIG1: git --refetch recovers from missing delta base objects :: Git 2.42+ `git --refetch` forces full refetch without relying on local objects as delta bases. Use when delta resolution fails due to missing blobs; bypasses corruption in repos where thin packs cannot resolve.
  ORIG2: Git Repository Recovery and Transient Errors :: Interrupted `git fetch` operations can corrupt the local object store, requiring a fresh clone from the remote repository; attempts to repair this with `git gc --aggressive` and `git prune` are ineffective. 'pack has N unresolved deltas' or 'invalid index-pack output' errors during `git fetch` are r

### 26 [global] UnityEvent Persistent Listener Management and Operator Overloading
id=fd8081a0f876cdf6 folded=3 minCos=0.841
HARD(9): RCP-editor-106 | MagicPig | RCP | 106 | RCP-monobehaviours-149 | AddPersistentCall | 149 | CodeStage/Maintainer | CodeStage
soft(3): Recipes/editor/unity-event-persistent-listener-count-reflection.md | Recipes/monobehaviours/event-operator-persistent-dynamic-routing.md | Recipes/editor/how-do-we-scan-unityevent-fields-for-invalid.md
MERGED: Persistent listener counts are read from SerializedProperty path "m_PersistentCalls.m_Calls" using reflection; this approach is stable across all UnityEvent subtypes and utilizes `FindPropertyRelative` within a PropertyDrawer with `useForChildren:true`. Invalid listener scanning involves paths "m_PersistentCalls.m_Calls", "m_Target", "m_MethodName", "m_Mode", and "m_Arguments.m_ObjectArgumentAssemblyTypeName", valida
  ORIG1: Recipe: UnityEvent persistent listener count via m_PersistentCalls reflection (RCP-editor-106) :: Read persistent listener count from SerializedProperty path "m_PersistentCalls.m_Calls".arraySize — stable across all UnityEvent subtypes. Use in PropertyDrawer with useForChildren:true to show listener count for any UnityEvent type without coupling to the concrete type. | approach: FindPropertyRela
  ORIG2: Recipe: operator+/- routes to persistent vs dynamic calls based on edit/play mode (RCP-monobehaviours-149) :: operator+(event, method): in EditMode + method.Target is Object → AddPersistentCall; otherwise → DynamicCalls +=. Uniform += syntax for callers; routing is transparent. Also null-creates event. | origin: UltEvents/UltEvent0.cs | file: Recipes/monobehaviours/event-operator-persistent-dynamic-routing.
  ORIG3: Recipe: Scan UnityEvent persistent listeners via serialized field paths (editor) :: UnityEvent serialized paths: m_PersistentCalls.m_Calls, m_Target, m_MethodName, m_Mode, m_Arguments.m_ObjectArgumentAssemblyTypeName. Validate with UnityEventDrawer.IsPersistantListenerValid via reflection + GetDummyEvent. Origin: CodeStage/Maintainer. File: Recipes/editor/how-do-we-scan-unityevent-

### 27 [RR-2DDestructible] Unity 6 URP DOTS Instancing Shader Migration
id=c3cbfb989929622e folded=2 minCos=0.884
HARD(9): UnityInstancing | CGPROGRAM | accessible via | To enable DOTS instancing, shaders must use | SAMPLE_TEXTURE2D_ARRAY | SAMPLE_TEXTURE2D | tex2D | UnityPerMaterial | GPU
soft(6): architecture_default_shader_dots_urp_hlsl_migration_decisions | UnityInstancing.hlsl | UnityCG.cginc | UNITY_DOTS_INSTANCING_START/END | Default.shader | UNITY_DOTS_INSTANCING_START
MERGED: In Unity 6 Universal Render Pipeline (URP) with Batch Renderer Groups (BRG), remove legacy instancing macros (`UNITY_VERTEX_OUTPUT_INSTANCE_ID`, `UNITY_SETUP_INSTANCE_ID`, `UNITY_TRANSFER_INSTANCE_ID`) as they are not present in Unity 6 SRP Core; BRG uses per-entity cBuffers. Keep only `UNITY_VERTEX_OUTPUT_STEREO` / `UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO` for VR functionality. DOTS instancing requires shaders to use 
  ORIG1: architecture_default_shader_dots_urp_hlsl_migration_decisions: Removed legacy instancing macros :: These do NOT exist in Unity 6 SRP Core and must be removed: - `UNITY_VERTEX_OUTPUT_INSTANCE_ID` (removed from UnityInstancing.hlsl) - `UNITY_SETUP_INSTANCE_ID` / `UNITY_TRANSFER_INSTANCE_ID` BRG uses separate per-entity cbuffers, not vertex-interpolated instance IDs. Keep only: `UNITY_VERTEX_OUTPUT_
  ORIG2: Default.shader DOTS Instancing in Unity 6 URP :: In Unity 6 Universal Render Pipeline (URP), all rendering passes through Batch Renderer Groups (BRG) using GPU Resident Drawers; therefore, `CGPROGRAM` and `UnityCG.cginc` cannot include the `UNITY_DOTS_INSTANCING_START/END` macros which reside in `com.unity.render-pipelines.core/ShaderLibrary/Unity

### 28 [global] Behavior Designer & MonoBehaviour Lifecycle Management
id=baeef6cda00f2cd4 folded=2 minCos=0.901
HARD(9): OnEnd | OnApplicationQuit | SetActive(false | AttachToPanelEvent | OnCollisionEnter | StateMachineBehaviours | OnStateEnter | OnStateExit | SetActive
soft(3): C:ran_Unity
ity-workflow-optimization | Destroy( | repository. VisualElements lack
MERGED: Register BD events in `OnAwake`, guarded by `if runStatus != TaskStatus.Running return early`; unregister them in `OnBehaviorComplete`. Defer `SendEvent` calls to `OnUpdate` via a flag set in `OnStart`, introducing a one-frame delay after leader tree activation. Use `Application.wantsToQuit` for synchronous pre-quit saving, register with `-=` before `+=`, unregister in `OnDisable`, returning `true`. Implement the But
  ORIG1: Behavior Designer Monobehaviour Initialization and Event Handling :: Register Behavior Designer (BD) events in `OnAwake` once, persistently; guard every handler with `if runStatus != TaskStatus.Running return early`. Unregister BD event handlers in `OnBehaviorComplete`, not `OnEnd`. Defer `SendEvent` calls to `OnUpdate` by setting a flag in `OnStart`; send the event 
  ORIG2: MonoBehaviour & VisualElement Lifecycle Conventions :: To prevent memory leaks and ghost invocations when a MonoBehaviour is destroyed, implement the ButtonOnClickSymmetry pattern (BP-uiux-002) in `Snippets/ui-ux/ButtonOnClickSymmetry.cs` within the `C: ran_Unity ity-workflow-optimization` repository, ensuring symmetric Awake/OnDestroy handling for butt

### 29 [C--Fran-LLM-Workflow-Optimization] ADR Record Management and Validation Issues
id=8522b7cfeff74450 folded=2 minCos=0.799
HARD(9): Fix-1 | adr-NNN-kebab-case-title.md | add_adr.py | reflector.ts | FEAT-20260730150659-74 | FEAT | YAML | SQL | 20260730150659
soft(1): grep -P '
0c
MERGED: Fail-closed supersede logic now requires a valid ADR/DDR ID in `readDecisionIndex()` before upgrades, preventing incorrect behavior from unvalidated citations; unresolvable IDs fall through to touch-and-continue deduplication. Generated ADR documents contain form-feed byte (0x0c) corruption detectable with `grep -P '0c'`, stemming from a string/encoding bug in the doc-sync pipeline. The ID-extraction regex in `src/ca
  ORIG1: Fail-closed ADR/DDR supersede validation :: Fix-1 supersede requires cited ADR/DDR id to exist in readDecisionIndex() before allowing upgrade. Unresolvable ids fall through to touch-and-continue dedup rather than hallucinated supersede. Prevents wrong behavior from unvalidated citations.
  ORIG2: ADR Record Management, Corruption, Validation, and Migration Issues :: Generated ADR documents contain form-feed byte (0x0c) corruption detectable with `grep -P ' 0c'`, affecting all files; a string/encoding bug exists in the doc-sync pipeline. The ID-extraction regex in `src/capture/docspine.ts` line ~21 incorrectly parses timestamp-form ADR filenames (`adr-YYYYMMDDHH

### 30 [C--Fran-uber-db] Symbols Table Data Loss, Null Language, and Edge Resolution
id=b4e1ceeed73202f5 folded=2 minCos=0.834
HARD(9): resolveEdges | writeFileEdges | returning | assignAndWriteSymbols | tx( | content_hash | reindexFile/indexProject | EdgeRow | TEXT
MERGED: src/symbols/store.ts writes language:null for all symbols due to a pre-existing gap unrelated to the structural-tool build order; new query tools' language field will return null until a separate backfill is completed, affecting find_symbol, file_symbols, callers, and callees. src/schema.ts unconditionally drops the symbols and symbol_edges tables on every openDb() call via its migrate() function, causing data loss t
  ORIG1: Symbols Table Data Loss, Benchmarking, and Edge Resolution :: The symbols table stores qualified_name and container information in a meta TEXT field, mirroring chunks/projects patterns with language currently NULL. src/schema.ts's migrate() function unconditionally drops the symbols and symbol_edges tables on every openDb() call, causing data loss that blocks 
  ORIG2: Store always writes language:null :: src/symbols/store.ts writes language:null for all symbols—pre-existing gap unrelated to structural-tool build order. New query tools' language field will return null until separate backfill. Affects find_symbol, file_symbols, callers, callees, impact.

### 31 [global] ActiveEditorTracker Reflection for InspectorWindow Editors
id=a448d97bde9744ec folded=2 minCos=0.821
HARD(8): MaterialPropertyDrawer | BOXOPHOBIC | PropertyEditor | PropertyInfo | CoInspector | RCP | 098 | 2021
soft(2): InspectorWindow/PropertyEditor | Recipes/editor/active-editor-tracker-inspector-window-reflection.md
MERGED: Extract-knowledge systematically analyzes editor scripts alongside shaders to identify transferable patterns, particularly custom inspector UI.
  ORIG1: Editor utilities yield high-value recipes from third-party assets :: BOXOPHOBIC asset pack's editor C# scripts yielded 10 valuable recipes about MaterialPropertyDrawer, ShaderGUI, and inspector UX patterns. When extract-knowledge mines third-party assets, systematically analyze editor scripts alongside shaders—they often contain transferable patterns about custom ins
  ORIG2: Recipe: ActiveEditorTracker reflection to read InspectorWindow editors (RCP-editor-098) :: Read which Editor instances run in an InspectorWindow/PropertyEditor by reflecting the internal tracker property — returns ActiveEditorTracker with .activeEditors array. Cache per window type. | approach: cached PropertyInfo per window type, null-safe, supports Unity 2021+ PropertyEditor | origin: C

### 32 [C--Fran-Voodoo-Magic] Locked Card Mechanics and Level-Proximity Approach
id=3fb813236989686a folded=2 minCos=0.821
HARD(8): DDR-017 | PlayClose | CardBackSprite | DDR | HUD | 180 | 017 | 270
soft(1): IPopupView.Close
MERGED: The locked card system uses a level-proximity approach, moving cards closer to the player based on their level via `OnLevelChanged` callbacks and proximity calculations, configurable with `approachWindowLevels` and `approachSlideDurationSeconds`. Cards are despawned while open (`despawnEligibility`) to prevent refreshes. Idle float tweens pause on tap to avoid `CardFlipPresenter` conflicts. Dismissal triggers `Refres
  ORIG1: Level-proximity approach creep integrated into locked cards :: The locked card system includes approach creep: the card moves closer as player level increases, driven by OnLevelChanged callbacks and proximity calculations (configurable via approachWindowLevels and approachSlideDurationSeconds knobs). This progressively reveals cards based on progression.
  ORIG2: Locked Card Mechanics and Animations :: {"lockedCardInitialPose": "deterministic, based on restored player level", "despawnEligibility": "pinned during open→close cycles to block concurrent refreshes", "idleFloatTweens": "pause on tap to avoid CardFlipPresenter position conflicts", "dismissal": {"trigger": "RefreshAsync for empty state re

### 33 [global] File System and Temporary File Handling Best Practices
id=d3f1cbe99dc5fb9d folded=2 minCos=0.883
HARD(8): FastScriptReload | FileNotFoundException | RCP-monobehaviours-144 | RCP-monobehaviours-145 | FileDialogExplorerPlugin | RCP | 144 | 145
soft(9): Recipes/editor/how-do-we-handle-visual-studios-multi-step-atomic.md | Recipes/editor/how-do-we-deduplicate-rapid-fire-file-change.md | Recipes/editor/how-do-we-recover-when-unitys-filesystemwatcher.md | Directory.Exists | File.Exists | Recipes/monobehaviours/fileattributes-bitflag-directory-file-check.md | Recipes/monobehaviours/try-catch-permission-gate-directory-scan.md | Recipes/editor/how-do-we-safely-read-editorprefs-and.md
MERGED: Visual Studio rename operations use temporary files with an `OldName` suffix, requiring debouncing to prevent double-processing; rapid-fire events are deduplicated by scanning for entries with the same path within a 500ms window. When `FileSystemEventArgs.FullPath` is missing, recover incorrect Unity paths using `Directory.GetFiles(Application.dataPath, fileName, AllDirectories)` due to an editor bug. Use `File.GetAt
  ORIG1: File System Watcher Handling for Visual Studio and Unity :: Visual Studio uses rename operations (temp file then rename) requiring `OldName` temp suffix debouncing to avoid double-processing/compilations. Deduplicate rapid-fire events by scanning the pending list for entries with the same path within a 500ms window. Recover from incorrect Unity paths using `
  ORIG2: File and Directory Handling, Sanitization, and Temporary File Management :: To reliably distinguish files from directories, use `File.GetAttributes(path) & FileAttributes.Directory` after confirming path existence to avoid `FileNotFoundException`, as `Directory.Exists` is false for files and `File.Exists` is false for directories; during directory enumeration, wrap `Directo

### 34 [C--Fran-Voodoo-Magic] Rendering Configuration and Mobile Performance Constraints
id=b7be9ea96ad210b4 folded=2 minCos=0.872
HARD(8): DDR-012 | LOD | SRP | PSD | URP | DDR | WHY | 012
MERGED: Rendering settings are centralized in ADR-042 within architecture.md; the project uses Universal Render Pipeline with Render Graph (Compatibility Mode off), enforcing an all-unlit constraint, necessitating separate Mobile_RPAsset / PC_RPAsset assets per quality level. HDR is enabled pending bloom-threshold retune due to HDR-bloom coupling; disabling HDR clamps the color buffer to [0,1], eliminating bloom and degradin
  ORIG1: HDR/Bloom/MSAA Mobile Rendering Constraints & Optimization :: HDR cannot be disabled while bloom thresholds > 1.0 (currently 1.2, 1.15). Disabling HDR clamps color buffer to [0,1], eliminating bloom and degrading visuals. HDR buffer R11G11B10 (32-bit) does not significantly impact bandwidth vs LDR RGBA8; FP16 would double it. Primary bloom cost: pass iteration
  ORIG2: Rendering Configuration & Shader Design Decisions :: Rendering settings including MSAA, HDR, upscaling filter, LOD cross-fade, GPU resident drawer, SRP/dynamic batching, store actions, grading/LUT, alpha output, fast sRGB, lens flares, depth/opaque textures, and adaptive performance are centralized in ADR-042 within architecture.md to establish a sing

### 35 [global] Dataflow & Cancellation Conventions
id=bd640d6570b4ad3d folded=2 minCos=0.854
HARD(8): unlockCancellationRegistration | openInstance | isExpired | PopupController.OpenForUnlockAsync | PopupController | OpenForUnlockAsync | OnClose | CPU
MERGED: Use `ExecutionDataflowBlockOptions.CancellationToken` for coordinated dataflow mesh cancellation; use `CancellationTokenSource.CreateLinkedTokenSource()` to manage concurrent cancellation. Parallel operations require cancellation support, and methods with `IProgress<T>` should offer best-effort cancellation via `CancellationToken`. `CancellationToken` requires explicit cooperation (checks or `cancellationToken.Regist
  ORIG1: CancellationToken Best Practices and Pitfalls :: CancellationToken requires explicit cooperation via checks within methods; non-compliant code needs `cancellationToken.Register()` for APIs lacking native support. Prefer System.Reactive subscription/disposal at Rx/non-Rx boundaries only. Asynchronous disposal: private `CancellationTokenSource` in `
  ORIG2: Dataflow & Cancellation Conventions :: When creating dataflow blocks, use `ExecutionDataflowBlockOptions.CancellationToken` to enable coordinated cancellation across the entire dataflow mesh and allow external signals to interrupt processing; concurrent cancellation from multiple sources like user actions and timeouts can be managed with

### 36 [global] Progressive VFX, Light Fades, Particle Alpha & Themed Color Changes
id=828fe55af5ba04c3 folded=3 minCos=0.783
HARD(8): RCP-vfx-001 | RCP-vfx-014 | RCP-vfx-002 | Fran_Unity | RCP | 001 | 014 | 002
soft(3): Recipes/vfx/threshold-progressive-vfx-activation.md | Recipes/vfx/light-fade-intensity-proportional-drain.md | Recipes/vfx/particle-cleanup-guard-destruction-animation.md
MERGED: Pair VisualEffect damage VFX with normalized thresholds using `math.remap`; activate when normalizedDamage >= threshold; smooth fades with `Mathf.MoveTowards`. Fade lights to zero by decrementing intensity: `initialIntensity * (Time.deltaTime / lifeDuration)` per frame, controlled by `lifeDuration`. Prevent GameObject destruction until timeline duration elapses AND `aliveParticleCount` <= 0 for all VisualEffect compo
  ORIG1: Day/Night Lighting Transition :: Lighting parameters (ambient intensity, directional intensity, shadow strength, light color) transition continuously between day and night targets using Vector4.MoveTowards per frame, controlled by `transition_speed`. Initial lighting state is snapped instantly at Start() via `UpdateLights()` with s
  ORIG2: Progressive VFX Activation, Light Fade, and Particle Cleanup :: To progressively activate multiple VisualEffect damage VFX based on normalized health, pair each effect with a normalized threshold using `math.remap` and activate when normalizedDamage is greater than or equal to the threshold, smoothing the fade with `Mathf.MoveTowards`. Fading a light to zero in 
  ORIG3: Particle Alpha Fade and Themed Color Changes :: Fading a ParticleSystem’s alpha requires using `GetParticles`, mutating the start color's alpha component (`startColor.a`), and then calling `SetParticles`; modifying only `main.startColor` affects particles emitted *after* the change, not existing ones. When theming UI elements with alpha-based ani

### 37 [C--Fran-LLM-Workflow-Optimization] Harvest Workflow & Critic Signal Restriction
id=74b708bcf9c68e6f folded=2 minCos=0.827
HARD(8): add_atom UPDATE | proposal_taxonomy.py | ## Other | add_proposal.py | _insert_one | Master-tooling-reference.md | proposals.db | UPDATE
MERGED: The `harvest-critic` agent emits only `⚑` and `named-target` signals with binary confidence scores ('high' - `⚑`, 'low'), replacing the previous 'medium' default. Phase 2.5 utilizes `harvest-critic` between Phase 3 reporting and Phase 4A atom spawning to flag items lacking named implementation targets or relying on weak sources. Atoms include a `confidence` field ('high', 'medium', 'low') initially based on source co
  ORIG1: Knowledge Staleness, Data Consistency, and Harvest Workflow :: Master-tooling-reference.md errors are categorized as staleness due to policy implementation drift affecting CoD and budget_tokens recommendations from tdd-complexity-classifier.md and flow.schema.json; reversed decisions aren't back-propagated (GitNexus adoption). Harvest-time errors include Graphi
  ORIG2: Harvest Critic Signal Restriction & Binary Confidence Classification :: The Harvest-critic agent (harvest-critic) is restricted to emitting only two observable signals: `⚑` and `named-target`, reducing coupling and improving traceability; confidence scores for harvested items are now binary ('high' - `⚑`, 'low'), with 'medium' using the schema default. A new Phase 2.5 u

### 38 [global] Unity Editor Conventions and Tooling
id=961154cf442d681b folded=3 minCos=0.773
HARD(8): This avoids reflection-based solutions like the | RumbleUnityKnowledge | CoInspector | GetPropertyHeight( | labelWidth | MaterialPropertyDrawers | GetPropertyHeight | PropertyDrawers
soft(1): Fran_Unity
MERGED: To display a link cursor over a rectangle in IMGUI, use `GUILayoutUtility.GetLastRect()` and trim the rect's width to `style.CalcSize(label).x`, then call `EditorGUIUtility.AddCursorRect` with `MouseCursor.Link`; when drawing word-wrapped `GUILayout.Button` elements, set `fixedHeight=0` and use `GUIStyle.CalcHeight` before drawing to prevent clipping. String arrays can be displayed as IMGUI popups for round-trip edit
  ORIG1: Unity Editor Tool Location, NavMesh API, and Toolbar Customization :: In Unity 6000.0+, replace `GameObjectUtility.GetNavMeshAreaNames()` with `NavMesh.GetAreaNames()`, both returning a `string[]` of area names. Locate Unity editor tools via `EditorApplication.applicationContentsPath` using `Directory.GetFiles(EditorApplication.applicationContentsPath, toolName, Searc
  ORIG2: Editor Workflow & State Management Conventions :: Shortcut methods are declared in a dedicated class, discovered via the [Shortcut] attribute regardless of class type, and globally available independent of window lifecycle, with mouse-button shortcuts requiring #if UNITY_2022_1_OR_NEWER; large EditorWindows should be split into internal partial cla
  ORIG3: Unity Editor UI Techniques & Conventions :: To display a link cursor over a rectangle in IMGUI, use `GUILayoutUtility.GetLastRect()` and trim the rect's width to `style.CalcSize(label).x`, then call `EditorGUIUtility.AddCursorRect` with `MouseCursor.Link`; when drawing word-wrapped `GUILayout.Button` elements, set `fixedHeight=0` and use `GUI

### 39 [global] Coroutine Management Conventions and UI Population Strategy
id=4a8e86441537ead0 folded=2 minCos=0.837
HARD(7): BP-monobehaviours-033 | Knowledge/monobehaviours.md | StartCoroutine | 033 | RCP-ui-ux-036 | RCP | 036
soft(1): StopCoroutine/StartCoroutine
MERGED: When stopping a coroutine started by name, always use the string-name overload of `StopCoroutine` to avoid invisible, duplicate instances causing issues like double event firing; mixing overloads results in both old and new instances running concurrently. To prevent concurrent corruption when populating a UI list, implement a persistent `while(true)` coroutine gated by a boolean flag, where setting the flag initiates
  ORIG1: BP-monobehaviours-033 — StopCoroutine/StartCoroutine string-name consistency :: Always use the string-name overload of StopCoroutine when the coroutine was started by name. Mixing string and IEnumerator overloads for the same coroutine leaves the old instance running invisibly alongside the new one — producing duplicate active behavior trees, double-firing events, or ghost AI. 
  ORIG2: Recipe: Infinite coroutine UI population state machine (RCP-ui-ux-036) :: How to prevent concurrent coroutine corruption when populating a UI list: run a single persistent while(true) coroutine gated on a bool flag. Caller sets the flag; coroutine tears down old items and builds new ones, then clears the flag. A second request while building keeps the flag set — no cancel

### 40 [C--Fran--Unity-unity-workflow-optimization] Lean Feature Flow Integration & Workflow
id=a81ed0da70834327 folded=2 minCos=0.821
HARD(7): /tdd | card_write.py | execute.md:91 | audit-after.json | execute.md | JSON | CHECKPOINT
soft(3): flow.yaml:82 | manual-work.md | flow.yaml
MERGED: {"lean_feature_flows": {"description": "Integrate unity-knowledge for design choices and best-practice guidance; use Claude Nexus integration."}, "nexus_integration": {"init": "nexus-recall injects prior project decisions/context.", "close": "nexus-remember persists new decisions and cross-links them." }, "opus_lean_planner": {"planning": "Primarily uses a prefetched digest; falls back to `search_unity_knowledge` if 
  ORIG1: Lean-Planner Workflow and Fallbacks :: The Opus lean-planner primarily uses a prefetched digest for planning; it falls back to `search_unity_knowledge` if the digest is insufficient, enabling recovery from retriever misses. Unity feature development classifies reuses using `tdd-complexity-classifier` (binary: simple|complex), retrieves a
  ORIG2: Lean Feature Flow Integration with Unity Knowledge & Nexus :: Lean feature flows require consultation of unity-knowledge during both discovery (plan phase for design choices) and implementation (best-practice guidance), ensuring active consumption and improved decision quality; these flows must also include full Claude Nexus integration, specifically nexus-rec

### 41 [global] Non-Destructive State Suppression and Restoration Recipe
id=287e4e5c9f85fc07 folded=3 minCos=0.809
HARD(7): RCP-monobehaviours-040 | RCP | 040 | RCP-monobehaviours-045 | 045 | RCP-monobehaviours-052 | 052
soft(3): Recipes/monobehaviours/backup-restore-state-suppression.md | Recipes/monobehaviours/three-state-heightmap-buffer-non-destructive-preview.md | Recipes/monobehaviours/state-suppression-restoration-command-lifecycle.md
MERGED: Temporarily suppress resources by backing up original values into a dictionary keyed by resource ID, restoring them afterward and clearing the backup; nested suppression is guarded by restoring values before each new suppress call. Within ICommandLogic, use OnRestore, OnPreview, Execute, and OnCancel lifecycle methods to manage state changes independently, incorporating dirty checks to avoid redundant restore-suppres
  ORIG1: Recipe: Backup-restore pattern for non-destructive state suppression (RCP-monobehaviours-040) :: How do we temporarily suppress a resource (e.g., fog density) without losing its original value when multiple systems may request suppression? | approach: back up original values into a dictionary keyed by resource ID before mutating, restore by iterating the backup and clearing it after; guard nest
  ORIG2: Recipe: Three-state heightmap buffer for non-destructive preview (RCP-monobehaviours-045) :: How do we implement non-destructive terrain heightmap preview with instant cancel and no disk re-read? | approach: maintain CommittedData/PreviewData/IsDirty per tile; OnPreview writes PreviewData, OnRestore copies Committed back, Execute promotes Preview to Committed; dirty flag limits loops to cha
  ORIG3: Recipe: State suppression and restoration lifecycle for non-destructive interactive feedback (RCP-monobehaviours-052) :: How do we integrate suppressible state into an ICommandLogic so preview suppresses non-destructively, execute commits permanently, and cancel or failed validation always restores cleanly? | approach: four lifecycle methods (OnRestore/OnPreview/Execute/OnCancel) each own one concern; dirty check skip

### 42 [global] Procedural Mesh Cleanup, Blend Shape Handling, and Geometric Integrity Checks
id=f5c78854ac26a5cb folded=2 minCos=0.814
HARD(7): and available as a snippet at | within the repository | When restoring meshes with blend shapes, always call | beforehand to avoid | errors when using | delta arrays for | NaNs
soft(2): which requires three non-null | C:	ran_Unity
ity-workflow-optimization
MERGED: To prevent degenerate quads and NaN normals in procedural polygon meshes, a two-pass cleanup process removes adjacent duplicate vertices (Pass 1) followed by collinear midpoints via an angle check (`Recipes/performance/how-do-we-prevent-degenerate-quads-and-nan.md`, `Snippets/performance/ProceduralPolygonCleanup.cs`, repository `C:ran_Unityity-workflow-optimization`). When restoring meshes with blend shapes, call `me
  ORIG1: Procedural Polygon Mesh Cleanup and Blend Shape Handling :: To prevent degenerate quads and NaN normals in procedural polygon meshes, a two-pass cleanup process is required; Pass 1 removes adjacent duplicate vertices including wrap-around pairs, followed by Pass 2 which removes collinear midpoints via an angle check. This sequence is critical because zero-le
  ORIG2: Geometric Integrity and Mesh Readability Checks :: OnValidate should clamp ScriptableObject parameters whose valid range depends on another parameter's value, mirroring this guard in runtime code to prevent silent broken-mesh generation; this applies within the editor domain (file: Knowledge/editor/onvalidate-enforced-geometric-integrity-for.md, rep

### 43 [C--Fran-LLM-Workflow-Optimization] Web Retrieval Search Fallback Chain Architecture
id=1c24d9ed05478f8d folded=2 minCos=0.736
HARD(7): LLM | SearchError | PreToolUse | CSE | HTTP | 429 | 402
soft(5): detect_vertical( | fetch_vertical( | fetch( | detect_vertical | fetch_vertical
MERGED: The `web_retrieval` system uses an API-based search fallback chain prioritizing Tavily, Exa, Google Custom Search, and Brave Search API to avoid bot-blocking; scrapers like SearXNG are avoided. The retrieval process utilizes native WebSearch/WebFetch tools with ToolSearch(query: "select:WebSearch,WebFetch") for deferred schema loading. The `web_retrieval.retrieve` CLI tool is installed via `pip install -e` and invoke
  ORIG1: API-based search engines > scraping for LLM pipelines :: API-based search engines (Brave Search API, Google Custom Search, Tavily) avoid bot-blocking problems that plague scraper-based approaches. They offer better reliability, lower latency, and cleaner content extraction than scraper-based engines like SearXNG.
  ORIG2: Web Retrieval Search Fallback Chain Architecture :: web_retrieval implements a fallback chain: Tavily (primary), Exa, Google CSE, Brave Search API; balancing capability with quota management. Tavily is primary but expensive to conserve. The ordered chain replaces SearXNG and prioritizes providers sequentially, handling HTTP 429/402 errors and network

### 44 [C--Voodoo-Paper2-clean-diagnostics] Fixture Variant Edge Extraction & Zone Merge Optimization - Loop Closure
id=f986d4ba45fbdfe8 folded=2 minCos=0.865
HARD(7): LargestArea | PreferBigger | PreferSmaller | PreferShorterArc | Union(ZonePoints, ZonePoints | 9.196 | 196
soft(1): Fixture_InsufficientGainAfterMerge
MERGED: Raw edge data is recovered from fixture variants (CW vs CCW) using `ExtractEdge` with zero extraction failures when trailing geometry matches, computing the longest common suffix of zone-arc prefixes and appending an identical edge. Zone merging directly merges raw candidates utilizing `ZonePoints` entries as boundary points, bypassing Clipper2 seam recomputation and avoiding winding direction issues in `Clipper2.Uni
  ORIG1: Loop Closure Optimization and Rejection of Single-Union Approach :: The single-union loop closure approach (Option D), documented in option-d-single-union-loop-closure-investigation.md, was rejected due to negative pass rate results and a risk: multi-lobe shapes using the LargestArea clipper strategy may fail or produce incorrect results, requiring validation agains
  ORIG2: Fixture Variant Edge Extraction & Zone Merge Optimization :: Raw edge data is recovered from fixture variants (CW vs CCW) by computing the longest common suffix of zone-arc prefixes and appending an identical edge, implemented via `ExtractEdge` with zero extraction failures across 24 fixtures when trailing geometry matches. Zone merging now directly merges ra

### 45 [C--Fran-Voodoo-Magic] Mobile Addressable Resilience & Configuration
id=61e760d7e96733c6 folded=2 minCos=0.871
HARD(7): ADR-072 | ADR-074 | TextAsset | AddressablesAssetService | ADR | 072 | 074
MERGED: Skins Addressables groups require `m_Timeout = 30` seconds and `m_RetryCount = 3` for mobile network resilience, necessitating rebuilds/re-pushes to R2 with PackTogetherByLabel tuning. BundleMode enum: 0=PackTogether, 1=PackSeparately, 2=PackTogetherByLabel; per-label/theme groups require mode 2 and SpriteAtlasManager binding. Theme groups reside in `Assets/Domains/*/Events/` with labels like `skin_<season>` (e.g., `
  ORIG1: Mobile Addressables resilience settings :: Skins Addressables group should set m_Timeout 30 (seconds) and m_RetryCount 3 to handle flaky mobile network drops. Also rebuild Addressables and re-push bundles+catalog to R2 for these settings to take effect. Paired with PackTogetherByLabel tuning.
  ORIG2: Unity Addressables Configuration, Bundling, Deployment, and Theming :: BundleMode enum: 0=PackTogether, 1=PackSeparately, 2=PackTogetherByLabel; per-label bundling requires mode 2; ADR-072 incorrectly used mode 1 (ADR-074 fixed); verify bundle counts during builds. Theme groups require PackTogetherByLabel (mode 2) for atomic SpriteAtlasManager binding; place in Assets/

### 46 [C--Fran-IntoTheEndlessSea] Pickup Sprite Paths and Resource Loading Convention with Rename Safety
id=b5cf232e27870d8f folded=2 minCos=0.874
HARD(7): ADR-052 | ItemTypeWeight | ArtifactDropEntry | ModuleDefPath | GUID | ADR | 052
soft(4): DropTableConfigSO.ItemTypeWeight.SpritePath | DropTableConfigSO.ArtifactDropEntry.ResourcesPath | PlayerLoadoutData.ModuleDefPath | UpgradeOption.ModuleDefPath
MERGED: PickupItemData and DropTableConfigSO store pickup sprite paths as FixedString128Bytes (e.g., "Pickups/ModPickup") for unmanaged ECS singleton components, loading sprites at runtime using Resources.Load<Sprite>(path) within MonoBehaviour controllers; item sprites reside in Assets/Resources without file extensions like 'UI/Items/sprite'. DropTableConfigSO.SpritePath and similar fields follow this convention for ECS com
  ORIG1: String resource paths need editor-safety wrapper for rename-safety :: String-based resource paths (vs GUID) are rename-unsafe; post-authoring renames cannot be validated at runtime. ScrapAndItemDropSystem fails to set PickupItemData.ItemPath (populated from ArtifactDefinition.ResourcesPath via private editor-only PlayerLoadoutManager.GetResourcesPath()), causing silen
  ORIG2: Pickup Sprite Paths & Resource Loading Convention :: PickupItemData and DropTableConfigSO store pickup sprite paths as FixedString128Bytes (e.g., "Pickups/ModPickup") to accommodate unmanaged ECS singleton components, preventing Sprite references from being stored directly; sprites are loaded at runtime using Resources.Load<Sprite>(path) within MonoBe

### 47 [C--Fran-Voodoo-Magic] HorizontalLayoutGroup Card Removal & Incremental Reconciliation
id=5fb472fbb4a421eb folded=3 minCos=0.739
HARD(7): LockedCardView.CardTransform | CaptureSource | LockedCardView | CardTransform | MainInstaller | EventPopupView | EventHudView
soft(3): CardFlipPresenter.CaptureSource | EventPopupView._flip | EventHudView._flip
MERGED: GameObject creation with HorizontalLayoutGroup initially snaps elements to final positions; dismissing an event card triggers a full rebuild, causing neighbors to snap due to new object creation. Smooth removal animates LayoutElement.preferredWidth toward 0 and collapses layout spacing, enabling gradual sliding. IEventView (ADR-020) exposes SlotRoot (RectTransform) and SetVisible(bool), toggling CanvasGroup alpha (hi
  ORIG1: CardFlipPresenter UI Animation & IEventView Architecture :: IEventView (ADR-020) exposes SlotRoot (RectTransform) and SetVisible(bool) toggling CanvasGroup alpha (hidden: α=0, visible: α=1). EventController._eventView is private; store (IEventView, EventController) tuples for pending slots. CardFlipPresenter.CaptureSource(RectTransform, Canvas, homeSlot) cap
  ORIG2: Incremental Event Card Reconciliation in HudController :: When dismissing an event card in `HudController`, implement incremental reconcile to avoid wasteful reloading of unchanged cards' Addressable skins and views, as documented in ADR-051; this involves only adding newly-visible events, removing newly-dismissed ones, and leaving unchanged cards in place
  ORIG3: HorizontalLayoutGroup Card Removal Animation :: When GameObjects are created and laid out by HorizontalLayoutGroup, they initially snap to final positions on frame one without transitioning from old positions; dismissing an event card triggers a full rebuild of all visible cards, causing neighbors to appear to 'snap' into new positions. This beha

### 48 [C--Voodoo-Paper2-clean-diagnostics] World League Paint Bucket Reachability and State Desynchronization
id=6a7b9ddc3a5b9e86 folded=2 minCos=0.894
HARD(7): 1786 | CountryController.CurrentPlayingCountryOverride | CountryController | CurrentPlayingCountryOverride | TryConquerCountry | HasPickableCountriesForLocalPlayer | 100
MERGED: Correctly-enrolled World League players cannot independently reach the paint bucket; eligibility is gated by the default model (enabled) versus round-arena (disabled), with enrolled players permanently routed through round-arena via IsInWorldCompletedMode=true. The edge case UserEnrolled && !IsRoundArena arises from Quests, Golden Shield, or boot-time resolution races and isn't typical World League behavior; IsInWorl
  ORIG1: Paint bucket unreachable for enrolled World League players :: Corrected assumption: paint bucket NOT independently reachable for correctly-enrolled World League players in steady state. Eligibility is model-gated: enabled on default model, disabled on round-arena. Enrolled players always route through round-arena (IsInWorldCompletedMode=true permanently), so p
  ORIG2: World League State Desynchronization and Crash :: UserEnrolled && !IsRoundArena represents an edge case from Quests, Golden Shield, or boot-time resolution races, not typical World League player behavior; IsInWorldCompletedMode is synchronously set to true in WorldController.OnCountryConquered upon last-country conquest and resets only for non-enro

### 49 [C--Fran-Voodoo-Magic] Grimoire Tarot Integration & Input System
id=bd1b90de8a96b026 folded=2 minCos=0.876
HARD(7): StreamingAssets | HTTP | SetSiblingIndex + sortingOrder | t=clamp01((window−distance+1)/(window+1 | EventUnlocked | SetSiblingIndex | LevelChanged
soft(2): MenuController.LevelChanged | RevealMode.None
MERGED: Grimoire content integrates tarot arcana (Tower, Star, Moon, Hermit, Death, Hanged Man, High Priestess, Wheel of Fortune, Devil, Sun) with numbered figures, tables, and glyphs to visually represent narrative degradation. Persisting revealed occult objects in PlayerState.revealedOccultObjects as HashSet<int> are gated to non-expired events. Distortion is calculated as distortionStage + revealedOccultObjects.Count and 
  ORIG1: Grimoire Input System & Architecture :: Grimoire book UI requires the new Input System with `activeInputHandler=1` in ProjectSettings and uses `Pointer.current` for input reads within `GrimoireBook.cs`, necessitating Unity.InputSystem added to VoodooMagic.asmdef; the system utilizes `GrimoireBook.cs` (HTTP requests), `GrimoirePageContent.
  ORIG2: Grimoire Tarot Integration & Occult Object Reveal System :: Grimoire content integrates tarot arcana (Tower, Star, Moon, Hermit, Death, Hanged Man, High Priestess, Wheel of Fortune, Devil, Sun) as thematic and narrative elements, accompanied by numbered figures, tables, and glyphs to visually represent a narrative degradation from journal to scribbles. Occul

### 50 [C--Fran-Voodoo-Magic] Event Countdown, Animation & UI Optimization
id=1c5b454879e5cfb6 folded=3 minCos=0.812
HARD(7): DateTimeKind | LocalEventSource | BP-monobehaviours-005 | 005 | EventCardRevealAnimator | PlayReveal | GameObjects
soft(2): DateTimeKind.Local | countdownLabel.text
MERGED: TMP label text updates in EventContent.cs:21 use `if (label.text != newText) { label.text = newText; }` to prevent unnecessary re-meshing; the countdown timer label uses a StringBuilder redrawn only when the displayed second changes for performance optimization, applied across project UI code. Voodoo animation components (EyeBlink, CardIdleMotion, Tremble) replace Book of Hours coroutines and custom Easing (DDR-012),
  ORIG1: Event Countdown Synchronization and Server Time Handling :: Event countdowns require DateTimeZoneHandling.Utc pinned at the Json.cs level to prevent timezone shifts during Newtonsoft.Json deserialization (defaulting to DateTimeKind.Local). This centralized approach prevents client/server disagreement bugs. The countdown duration is EventInstance.Remaining (e
  ORIG2: Voodoo Animation System: DOTween Choreography :: Voodoo animation components (EyeBlink, CardIdleMotion, Tremble) use DOTween Pro, replacing Book of Hours coroutines and custom Easing (DDR-012). EyeBlink's fillAmount animates 1→0→1 as a synchronization signal via Sequence OnUpdate callbacks (e.g., PushRayLength); inspector values control open/close
  ORIG3: TMP Re-meshing Optimization & Countdown Component Clarification :: EventContent.cs:21 incorrectly updates `countdownLabel.text` without string equality checks, triggering unnecessary TMP re-meshing; the correct pattern is `if (label.text != newText) { label.text = newText; }`. In EventCardRevealAnimator, bounds reading in Prepare* methods should be moved to PlayRev

### 51 [global] WebSocket & Async Event Dispatch Patterns
id=8c9d5d999fbbe98a folded=3 minCos=0.762
HARD(6): RCP-monobehaviours-067 | ClientWebSocket | RCP | 067 | EditorCoroutines | 081
soft(5): ClientWebSocket.ReceiveAsync | Recipes/monobehaviours/websocket-background-thread-main-thread-dispatch-queue.md | EditorApplication.update-driven | Recipes/editor/editorapplication-update-driven-ienumerator-coroutine-http.md | Recipes/async/how-do-we-dispatch-network-events-from-a-socket.md
MERGED: {"WebSocket": {"ReceiveAsync": ["Task.Run", "Queue<T>", "Update()"], "Unity API calls": "background threads"}, "HTTP": {"Async HTTP requests": ["EditorApplication.update", "IEnumerator coroutine", "UnityWebRequest.SendWebRequest().isDone"]}, "Network events": ["intrusive free-list pool", "locked queue", "PollEvents: snapshot count"], "Origins": {"lock-guarded dispatch queue": "Synaptic AI Pro", "EditorApplication.upd
  ORIG1: Recipe: WebSocket background-thread main-thread dispatch queue (RCP-monobehaviours-067) :: Run ClientWebSocket.ReceiveAsync in Task.Run; enqueue deserialized messages into a lock-guarded Queue<T>; drain in Update() on the main thread — zero Unity API calls in the background task. | approach: lock-guarded main-thread dispatch queue | origin: Synaptic AI Pro | file: Recipes/monobehaviours/w
  ORIG2: Recipe: EditorApplication.update-driven IEnumerator coroutine for async HTTP (RCP-editor-081) :: Run async HTTP checks in the Unity Editor without threads or EditorCoroutines package — maintain an IEnumerator state machine advanced via EditorApplication.update; use UnityWebRequest + SendWebRequest().isDone polling. | approach: static IEnumerator field advanced in update delegate, UnityWebReques
  ORIG3: Recipe: Pooled cross-thread event dispatch (RCP-async/how-do-we-dispatch-network-events) :: How to dispatch network events socket-thread→main thread without per-callback allocations. Intrusive free-list pool + locked queue; PollEvents snapshots count before loop. | origin: LiveScriptReload/LiteNetLib | file: Recipes/async/how-do-we-dispatch-network-events-from-a-socket.md

### 52 [C--Fran-IntoTheEndlessSea] Burst Job Pointer Field Strategy and NativeArray Handling
id=a32582130f64606b folded=2 minCos=0.866
HARD(6): uint4* MasksPtr | int MasksLength | NativeArrays | MasksPtr | MasksLength | UnsafeLists
MERGED: {"ulist.Ptr": "uint4*", "ConvertExistingDataToNativeArray": {"reasoning": "balances simplicity against conversion overhead"}, "InvalidOperationException": {"cause": "NativeArray fields constructed from unsafe pointers"}, "[NativeDisableUnsafePtrRestriction]": {"resolution": "allows raw pointer fields (e.g., uint4* ptr) and separate length"}, "DD2D_CellProcessingSystem": {"example": "globalAlphaMasks"}, "GetUnsafeRead
  ORIG1: Simple vs complex Burst job pointer field strategy :: For Burst jobs: (1) simple jobs with minimal fields—pass ulist.Ptr directly as uint4* job field; (2) complex jobs with multiple NativeArray dependencies—use ConvertExistingDataToNativeArray wrapper at scheduling site to avoid changing job signature. Strategy balances code simplicity against per-call
  ORIG2: Job Structs with Unsafe Pointers & NativeArrays :: Parallel job validation rejects NativeArray fields constructed from unsafe pointers, throwing an InvalidOperationException; to resolve this, use raw pointer fields (e.g., `uint4* ptr`) marked with `[NativeDisableUnsafePtrRestriction]` and pass the length separately instead of wrapping in a NativeArr

### 53 [C--Fran-claude-nexus] Prompt Budget Allocation and Memory Consolidation
id=7221108d6988bac7 folded=2 minCos=0.874
HARD(6): BAND_LOW | refineCandidates( | DDR | 0.70 | 0.75 | 1.6
MERGED: Prompt token budget allocation uses `clusterSize * 3` sentences per cluster, mirroring ADR-018 at the merge level; this can exceed token limits. To mitigate pathological cases (approximately 170 merges), a proposed fix allocates prompt budget proportional to identifier count (not implemented). The memory clustering pass limits `MAX_CLUSTER = 3` and excludes handoff memories ('X-initialized') from extractable `MEMORY_
  ORIG1: Memory Consolidation and Merge Quality Calibration :: The memory clustering pass limits cluster size to `MAX_CLUSTER = 3` to allow related memories in subsequent clusters and prevent data loss; recent runs produce size-2 clusters, with `BAND_LOW` currently at 0.70 (tradeoff analysis for potential increase to ~0.75). Handoff memories ('X-initialized') a
  ORIG2: Prompt Budget Allocation :: The prompt token budget is allocated based on cluster size, with each cluster consuming `clusterSize * 3` sentences regardless of identifier density; this allocation provides a fixed space per source pair. This behavior mirrors the architectural budget constraint defined in ADR-018 at the merge leve

### 54 [global] Pooled Object Management Techniques
id=6f806d1b76260d31 folded=3 minCos=0.802
HARD(6): RumblePool.AddPrefab | OnUpdate | OnCreate | RumblePool | AddPrefab | respectively, all within the repository at
soft(2): Fran_Unity | C:ran_Unity
ity-workflow-optimization
MERGED: To guarantee `ListPool<T>` release after acquisition with `ListPool<T>.Get()`, use a `try`/`finally` block and `ListPool<T>.Release()` (see `Recipes/memory/listpool-try-finally-guaranteed-release.md`, repo `C:‫ran_Unityity-workflow-optimization`). Temporary arrays are pooled by length using a `[ThreadStatic] T[][]` indexed array pool (`UltEvents/Misc/ArrayCache.cs`, `Recipes/performance/threadstatic-indexed-array-poo
  ORIG1: Intrusive Free-List Pooling with Lazy Initialization :: Objects are pooled using an intrusive free-list, embedding a `Next` pointer for zero per-node overhead and to prevent unbounded growth via `Interlocked`. This is documented in Recipes/memory/how-do-we-pool-objects-at-high-throughput-without.md and implemented in Snippets/performance/TailPopNodePool.
  ORIG2: ListPool with try-finally and ThreadStatic Indexed Array Pool :: To guarantee `ListPool<T>` return, acquire a list using `ListPool<T>.Get()` before the operation scope, wrap the body in a `try` block, and call `ListPool<T>.Release()` within a `finally` block to ensure unconditional execution on early returns or exceptions; this pattern originates from `lands-of-o
  ORIG3: Lazy Initialization, Fixed Capacity Inputs, and Dictionary Pooling for Performance :: To lazily initialize per-key typed arrays in a dictionary, use `Dictionary<KeyType, ValueType[]>` with a `GetInitialized` helper that uses `TryGetValue` to return the cached array on hit; if missing, it allocates and initializes the full inner array once and caches it, originating from `lands-of-old

### 55 [global] Angle Containment and Clamping Conventions
id=44f60451e3bf5c5b folded=2 minCos=0.8
HARD(5): BP-monobehaviours-025 | Knowledge/monobehaviours.md | 025 | BP-monobehaviours-030 | 030
MERGED: When clamping `localEulerAngles`, use separate upper and lower band checks to avoid incorrect snapping due to the representation of -90° as 270°; for example, `Mathf.Clamp(-90, 90)` on 270° incorrectly resolves to 90°. To correctly contain angles with wraparound (0°/360°), normalize them to the range [0, 360) and invert the gap check when a > b, as naive >= and <= comparisons fail for arcs crossing 0°. This approach 
  ORIG1: BP-monobehaviours-025 — Clamp localEulerAngles with upper/lower band checks :: When clamping localEulerAngles (always 0–360), use separate upper/lower band checks instead of Mathf.Clamp — 270° represents -90°, so Mathf.Clamp(-90,90) on 270 gives 90, snapping to the wrong extreme. | domain:monobehaviours | file: Knowledge/monobehaviours.md#BP-monobehaviours-025 | repo: C:\Fran\
  ORIG2: BP-monobehaviours-030 — Angle containment with 0°/360° wraparound inversion :: Normalise angles to [0,360) then check a>b (range wraps through north) and invert the gap check; naive >= && <= fails for arcs crossing 0°. | domain:monobehaviours | file: Knowledge/monobehaviours.md#BP-monobehaviours-030 | repo: C:\Fran\_Unity\unity-workflow-optimization\Knowledge

### 56 [global] Conditional Format Argument Registration and Fallback
id=3a02f16d784c11b1 folded=2 minCos=0.825
HARD(5): RCP-ui-ux-005 | RCP | 005 | RCP-ui-ux-008 | 008
MERGED: To register localization format arguments, null-check optional components before adding named arguments to the format dictionary, minimizing argument surface area and preventing orphaned placeholders in xliff files; this approach originates from `lands-of-old-runtime` (file: `Recipes/ui-ux/conditional-format-argument-registration.md`, repo: `C: ran_Unity ity-workflow-optimization`). For type-specific UI text formats 
  ORIG1: Recipe: Conditional Format Argument Registration for Localization (RCP-ui-ux-005) :: How do we register localization format arguments only for components that actually exist on an entity? | approach: null-check each optional component before adding its named arguments to the format dict, keeping the argument surface minimal and avoiding orphaned placeholders in xliff files | origin:
  ORIG2: Recipe: How do we apply type-specific UI text formats defined per-building without duplicating UI logic or localization strings? (RCP-ui-ux-008) :: How do we apply type-specific UI text formats defined per-building without duplicating UI logic or localization strings? | approach: check LocalizedString.IsEmpty on a definition-component override field; use override if set, fall back to panel's default format | origin: lands-of-old-runtime | file:

### 57 [C--Fran-RumbleEditorTools] Framework Best Practices vs. Plugin-Specific Recipes
id=4173d54153768461 folded=3 minCos=0.845
HARD(5): negative standardVerticalSpacing | BaseType field walk | BaseType | PowerShell | JSON
MERGED: Patterns in plugins like vInspector and vHierarchy (reflection FieldInfo caching with null sentinel, rounded-rect IMGUI drawing using a 9-slice GUIStyle) necessitate framework-level Best Practices (BPs), not plugin-specific recipes; semantic search detected duplication. `unity-knowledge/extract-knowledge` mines reusable patterns from Unity asset folders (.cs, .shader, .hlsl, .compute, .asmdef files in batches of ≤20)
  ORIG1: Cross-plugin patterns warrant framework-level BPs not recipes :: vInspector extraction overlapped with vHierarchy on reflection FieldInfo caching (inheritance walk + null sentinel) and rounded-rect IMGUI drawing (9-slice GUIStyle). Patterns emerging independently in 2+ plugins indicate core framework techniques worth extracting as BPs for broader reusability, not
  ORIG2: Unity Knowledge Extraction Skill and hats Integration :: The `unity-knowledge/extract-knowledge` skill mines reusable patterns from Unity asset folders, discovering .cs, .shader, .hlsl, .compute, and .asmdef files in batches of ≤20 files per batch using parallel analysis agents with a quality bar. Findings are written as best-practices (with citation URL)
  ORIG3: Recipe Extraction Workflow :: For reliable recipe extraction from codebase analysis, always use a single invocation of `add_recipes.py` instead of individual JSON payloads and PowerShell calls; this avoids classifier timeouts observed in previous sessions. During vInspector extraction, 7 recipes were successfully added via batch

### 58 [global] Bake Terrain Trees to ECS with Offset and Scale, Lazy Affected Region Cache
id=caa7d16c3b928135 folded=2 minCos=0.853
HARD(5): RCP | 004 | box.IsDirty | IsDirty | 047
MERGED: To bake Unity Terrain native trees into ECS entities, extract `GetTreeInstance` data at bake time, scale normalized position by `terrainData.size`, add the terrain world offset, and compose widthScale/heightScale with prefab localScale per axis; this process originates from `lands-of-old-runtime` and is detailed in `Recipes/dots-ecs/terrain-tree-bake-offset-scale-composition.md` within the repository at `C:\ran_Unity
  ORIG1: Recipe: Bake Unity Terrain native trees into ECS with offset and scale composition (RCP-dots-ecs-004) :: How do we bake Unity Terrain native trees into ECS entities with correct world position and scale? | approach: Extract GetTreeInstance data at bake time, scale normalized position by terrainData.size, add terrain world offset, compose widthScale/heightScale with prefab localScale per axis | origin: 
  ORIG2: Recipe: Command buffer lazy affected-region cache (RCP-monobehaviours-047) :: How do we cache which terrain tiles intersect the active structure footprint once per dirty frame and share it across all downstream commands in a command buffer? | approach: a dedicated preprocess command runs first, fills AffectedTiles list, and skips recalculation unless box.IsDirty or validation

### 59 [global] Recipe: Lateral Waypoint and Ambush Trigger
id=89af22d4c99a50a9 folded=3 minCos=0.849
HARD(5): RCP | 117 | 119 | HasArrived | 122
MERGED: For far-side surround slots, insert a lateral waypoint at radius+agentRadius on the correct side before navigating to the final position, using InverseTransformPoint for rotation-agnostic behind-center detection (file: Recipes/monobehaviours/surround-lateral-detour-waypoint.md). For flanking, set the agent's destination to a perpendicular lateral waypoint at attackDist + approachDist before the final slot (file: Reci
  ORIG1: Recipe: Surround lateral detour waypoint to avoid cutting through target (RCP-monobehaviours-117) :: For far-side surround slots, insert a lateral waypoint at radius+agentRadius on the correct side before navigating to the final position. Uses InverseTransformPoint for rotation-agnostic behind-center detection. | origin: Behavior Designer Tactical | file: Recipes/monobehaviours/surround-lateral-det
  ORIG2: Recipe: Ambush trigger via monotonic minimum distance tracking (RCP-monobehaviours-119) :: Track closestApproach = float.MaxValue; when current distance > closestApproach, enemies have passed — start attack delay timer. Works for any approach direction. Reset on OnEnd. | origin: Behavior Designer Tactical | file: Recipes/monobehaviours/ambush-monotonic-min-distance-trigger.md
  ORIG3: Recipe: Flank lateral approach offset before final attack position (RCP-monobehaviours-122) :: Set flanking agent destination to a perpendicular lateral waypoint at attackDist + approachDist before the final slot. Only after HasArrived() at the lateral point do agents proceed to the attack slot. Prevents agents from crossing the target's front arc. | origin: Behavior Designer Tactical | file:

### 60 [global] Prevent Hot Reload System Self-Patching and Editor Hangs
id=fd346cf6f84049e3 folded=2 minCos=0.824
HARD(5): GetField(BindingFlags.NonPublic | The root cause is including inherited methods like | NonPublic | GetCustomAttribute<SkipPatching>( | GetCustomAttribute
soft(1): BindingFlags.NonPublic
MERGED: To prevent infinite loops and editor hangs, implement an attribute-gated opt-out mechanism for method detouring to avoid patching the hot-reload system's infrastructure or types with static state critical to reload. Decorate such types with either a `[SkipPatching]` attribute (see Recipes/editor/how-do-we-prevent-a-reflection-based-patching.md) or a `[PreventHotReload]` attribute. Method detours *must* use `BindingFl
  ORIG1: Unity Method Detouring Requirements :: Method detours require `BindingFlags.DeclaredOnly`; omitting it and using `FlattenHierarchy` crashes the editor. Field/property queries can use `FlattenHierarchy`, but method detour targets must exclusively use `DeclaredOnly`. `GetField(BindingFlags.NonPublic)` only finds directly declared fields; t
  ORIG2: Prevent Hot Reload System from Patching Itself :: To prevent infinite loops and editor hangs during hot reloads, implement an attribute-gated opt-out mechanism for method detouring; specifically, this addresses scenarios where the hot-reload system attempts to patch its own infrastructure or types holding static state critical to reload. Decorate t

### 61 [global] Dynamic Formation Systems
id=778f5dbd801f10cb folded=3 minCos=0.774
HARD(5): C:\Fran_Unity\unity-workflow-optimization | Fran_Unity | 151 | AlternatingSidesSlotIndex | End(
soft(8): localSpacing = (spacing × agentsPerRow) / (sparseCount + 1 | Snippets/monobehaviours/AlternatingSidesSlotIndex.cs | (RCP-monobehaviours-123) and | Recipes/monobehaviours/alternating-sign-grid-row-column-formation.md | Recipes/monobehaviours/formation-sparse-layer-spacing-rescale.md | Recipes/monobehaviours/retreat-face-enemy-while-moving-backward.md | Recipes/monobehaviours/navmesh-formation-three-tier-speed-throttle.md | Recipes/monobehaviours/formation-catchup-dual-zone-speed.md
MERGED: Agents derive world position from `theta*formationIndex` each frame, recalculating `theta` as `2π/agents.Count` in `AddAgentToGroup` and `RemoveAgentFromGroup` (RCP-monobehaviours-116). Decentralized slot computation uses a `ComputePosition()` function; formation index determines agent position. Agents are added/removed via `AddAgentToGroup` and `RemoveAgentFromGroup`. The circle radius is calculated as `(spacing × c
  ORIG1: Dynamic Circle Formation and Decentralized Slots :: Agents derive world position from theta*formationIndex each frame, recalculating theta as 2π/agents.Count in both `AddAgentToGroup` and `RemoveAgentFromGroup`, ensuring the circle self-heals when agents die; this originates from Behavior Designer Tactical (RCP-monobehaviours-116). Each agent compute
  ORIG2: Alternating-Sign Grid Formation with Sparse Layer Spacing and Bilateral Slot Indexing :: The alternating-sign grid row-column formula for symmetric formation uses `column=index%agentsPerRow` and `col0=center, col1+: sign=(col%2==0)?-1:+1 * ((col-1)/2+1)` to produce outward symmetry regardless of agent count. For incomplete rows in formations, the local spacing is calculated as `localSpa
  ORIG3: NavMesh Agent Rotation, Formation Maintenance, and Speed Control :: When manually controlling NavMeshAgent rotation with Quaternion.RotateTowards(), disable `navMeshAgent.updateRotation` at task start and restore it in `End()`, zeroing `navMeshAgent.velocity` to prevent permanent rotation inheritance, as documented in Knowledge/monobehaviours.md#BP-monobehaviours-03

### 62 [global] Type-Safe Dictionary Deduplication and Serialization
id=58f9d43ddbdcdbc5 folded=3 minCos=0.8
HARD(5): RCP | 036 | GetHashCode | 073 | SerializableDictionary
MERGED: To achieve type-safe dictionary deduplication across entity types, use a readonly struct containing an enum type discriminator and an integer ID, implementing `IEquatable<T>` and utilizing `HashCode.Combine()` for the Dictionary key to ensure O(1) deduplication (file: `Recipes/monobehaviours/composite-key-struct-dictionary-deduplication.md`, repo: `C:‫ran_Unityity-workflow-optimization`). For serializable dictionarie
  ORIG1: Recipe: Composite Key Struct for Type-Safe Dictionary Deduplication (RCP-monobehaviours-036) :: How do we use a composite key struct for type-safe dictionary deduplication across multiple entity types? | approach: readonly struct with enum type discriminator + int id, IEquatable<T> + HashCode.Combine(), used as Dictionary key for O(1) dedup and paired with a List for ordered removal | origin: 
  ORIG2: Recipe: GOAP world state coercing GetState + deterministic hash (RCP-monobehaviours-073) :: How do we store heterogeneous world state in a type-erased dictionary and retrieve by type without hard casts everywhere? GetState<T> tries direct cast then Convert.ChangeType for type coercion. GetHashCode sorts keys before accumulation so insertion order doesn't affect equality — required for A* c
  ORIG3: Recipe: SerializableDictionary<K,V> with parallel list backing (RCP-serialization) :: How to implement a serializable Dictionary<K,V> that survives Unity serialization | approach: parallel [SerializeField] List<TKey>/List<TValue>, ISerializationCallbackReceiver rebuilds Dictionary | origin: Gaskellgames/GgCore | file: Recipes/serialization/how-do-you-implement-a-serializable-dictiona

### 63 [C--Fran-LLM-Workflow-Optimization] Flow Session Management and Identifiers
id=3d1da9a3a5e48e68 folded=3 minCos=0.807
HARD(5): __end__ | 20260525 | manages state and appends to | enforcing a single active | where
soft(5): artifact-creators-20260525-1430 | flow.yaml | flow.schema.json | flow-shared:flow-improver | namespace:name-agent
MERGED: {"phase_transitions": "share a single session ID stored in FLOW_SESSION_ID at flow activation", "state_persistence": [ ".flow/*/current.json", ".ged/", ".flow/<flow-name>/current.json" ], "agent_session_id": "extracted as <slug>", "concurrent_isolation": "flows isolated within .flow/.tdd/<session_id>/", "caching_key": "composite key of session_id plus the hash of the file path to prevent state leakage; .flow/classifi
  ORIG1: Session ID pinning at flow activation to avoid timeline race conditions :: Flow timeline markers (phase transitions, __end__ cap) must share a single session ID to prevent races when concurrent sessions write to the global transcript. Detect the session once at flow activation and store it in FLOW_SESSION_ID env var so all subsequent marks use the same ID.
  ORIG2: TDD Session Identifier and Branch Naming Conventions :: Session identifiers in TDD flows must include minute precision following the pattern `<slug>-YYYYMMDD-HHMM` (e.g., `auth-20260523-1430`); each run receives a unique folder and all phase output paths are derived from session_id (e.g., `.flow/tdd/<slug>/design.md`). Session ID resolution precedence is
  ORIG3: Flow State Management & Session Isolation :: To prevent state leakage when caching session data across different file paths, use a composite key of `session_id` plus the hash of the file path; this resolves issues where reusing `session_id` 'S1' against differing tmp_path files caused pollution. Flow state is persisted in `.flow/*/current.json

### 64 [global] Serialized Field Mutation and Event Handling Techniques
id=ba249296434d995a folded=3 minCos=0.832
HARD(5): RCP | 007 | 148 | RecordObjects | 109
MERGED: To mutate a struct field directly without silent copies, expose ref-returning accessor methods with switch-based index dispatch; callers bind via `ref var x = ref owner.GetRef(i)` (Recipes/memory/ref-returning-accessor-struct-mutation.md, C:\Fran_Unity\unity-workflow-optimization). For undo-safe multi-target SerializedProperty mutations, use the ModifyValues<T> extension method which records objects before mutation, 
  ORIG1: Recipe: Ref-returning accessor pattern for struct field mutations (RCP-memory-007) :: How do we mutate a field on a stored struct without creating a silent copy? | approach: expose ref-returning methods with switch-based index dispatch so callers bind with `ref var x = ref owner.GetRef(i)` and mutations go directly to the stored field | origin: lands-of-old-runtime | file: Recipes/me
  ORIG2: Recipe: Lazy-init serialized event field with null-guarded Invoke (RCP-monobehaviours-148) :: Private serialized backing field (may be null); public getter lazy-creates on access; Invoke() guards directly on field without lazy-create. Avoids allocation on no-listener instances. | origin: UltEvents/UltEventHolder.cs | file: Recipes/monobehaviours/lazy-init-serialized-event-field.md
  ORIG3: Recipe: ModifyValues<T> — undo-safe multi-target SerializedProperty mutation (RCP-editor-109) :: Extension method on SerializedProperty: RecordObjects before mutation, iterate all target object values via reflection, mark dirty + Update after. One call handles single- and multi-selection correctly. | origin: UltEvents/Serialization.cs | file: Recipes/editor/modify-values-multi-target-undo.md

### 65 [C--Fran-Voodoo-Magic] Controller Implementation and Event Handling Conventions
id=5025e83ffe921757 folded=3 minCos=0.77
HARD(5): Book.OnFlip | GrimoireView.OnPageFlipped | OnFlip | GrimoireView | OnPageFlipped
MERGED: Game logic controllers like PopupController, EventController, and UnlockSequencer are pure C# classes, not MonoBehaviours, instantiated and wired in MainSceneBootstrap (ADR-015) to maintain testability and decoupling; they are not serialized in scenes. Controllers are implemented as plain C# classes, avoiding interfaces. Intra-GameObject event hookups use serialized UnityEvent fields for visibility, alongside exposed
  ORIG1: Controllers are pure C#, not MonoBehaviour :: Game logic controllers (PopupController, EventController, UnlockSequencer) are pure C# classes, not Unity MonoBehaviours. They're instantiated and wired together in MainSceneBootstrap (the composition root, ADR-015), not serialized in scenes. This pattern keeps controllers testable and decoupled fro
  ORIG2: Controllers are plain C# classes :: Controllers in this project are implemented as plain C# classes (not interface-based). PopupController exemplifies this pattern.
  ORIG3: UnityEvent and C# Event Integration Pattern :: Intra-GameObject event hookups utilize serialized UnityEvent fields in the Inspector (e.g., Book.OnFlip → GrimoireView.OnPageFlipped()), replacing programmatic subscriptions to enhance visibility for non-programmers; UI components expose both a C# event (Action type) and a UnityEvent for the same lo

### 66 [C--Fran-uber-db] UberDB Configuration, Indexing, and Project Management
id=98fed13f98aa6cb2 folded=3 minCos=0.758
HARD(5): venv | gradle | godot | DerivedData | DevOps
soft(4): dart_tool | Configuration entries starting with '.' are written to | context_prefix | index_codebase
MERGED: UberDB documentation audits must cover both local docs/ and the LLM_Workflow_Optimization hub, including tool-groupings.md, master-tooling-reference.md, and knowledge-vault, excluding PR/CI dashboards, Docker/K8s hardening, auto-installers, and cross-language mobile SDKs due to its focus on personal code retrieval; UberDB employs a two-tier exclusion strategy using `~/.uberdb/config.json` (modifiable via the `UBERDB_
  ORIG1: UberDB Configuration, Exclusion Strategy, and Project Identification :: UberDB utilizes a two-tier exclusion strategy: Tier 1 employs global defaults in `~/.uberdb/config.json` (modifiable via the `UBERDB_DB_PATH` environment variable) to exclude directories like `.venv`, `.gradle`, `.godot`, `.dart_tool`, DerivedData, and Pods; Tier 2 uses project-specific configuratio
  ORIG2: Uber-DB Unity Knowledge Integration :: Unity knowledge is indexed in uber-db under project ID bd314d6b62313461c79ea8df402b24a3b96f4ade93be5eb7b53d0d89fdc18bcb, accessible via search(content_type='knowledge', project_id=bd314d6b62313461c79ea8df402b24a3b96f4ade93be5eb7b53d0d89fdc18bcb). claude-context tool search_unity_knowledge maps to th
  ORIG3: UberDB Documentation Audit & Scope :: Feature documentation audits for UberDB must encompass both the local docs/ and the LLM_Workflow_Optimization hub, including tool-groupings.md, master-tooling-reference.md, and knowledge-vault; this was initially missed during an earlier audit. The scope excludes PR/CI dashboards, Docker/K8s hardeni

### 67 [C--Fran-RumbleEditorTools] RCP Reflection Procedures & GUI Caching Optimization
id=b6656c711df6c93a folded=2 minCos=0.88
HARD(5): -EditorGUIUtility.standardVerticalSpacing | EditorGUIUtility.standardVerticalSpacing | GameViewSizes | PropertyDrawers | IMGUI
soft(2): style.display = None | style.display
MERGED: Add custom resolutions by reflecting `AddCustomSize` with a `SizeSelectionCallback` (2022+), falling back to direct modification of `m_SelectedSizeIndex`; use `GetSizeIndex` for new entries and runtime method presence detection via try/catch handles API drift. Restore Scene View overlay layouts using `OverlayPresetManager.ApplyPreset`, detecting the parameter type (EditorWindow vs OverlayCanvas) at runtime; preset na
  ORIG1: RCP Reflection Procedures :: To programmatically add and select custom resolutions in the GameViewSizes singleton, reflect `AddCustomSize` and use a `SizeSelectionCallback` (2022+), falling back to direct modification of `m_SelectedSizeIndex`; runtime method presence detection with try/catch handles API drift, and `GetSizeIndex
  ORIG2: RCP Reflection and GUI Caching Optimization :: To programmatically set Project Browser and Hierarchy search filters via reflection, access `ProjectBrowser` and `SceneHierarchyWindow` using `Resources.FindObjectsOfTypeAll`, then reflect on the `SetSearch/SetSearchFilter` methods, handling 1-argument (string) and 2-argument (string + SearchMode) v

### 68 [global] Cosmetic Variant Design & Abstract Row Models
id=d38bacd46ec41cce folded=3 minCos=0.759
HARD(4): SDUI | RCP-ui-ux-024 | RCP | 024
MERGED: Server-driven UI composition for cosmetic variants over-engineers and violates the no-speculative-abstraction rule; use an archetype selector field instead. Distinguish between cosmetic (appearance/skin) and structural (layout/behavior) variant axes, favoring a single reusable structure with content-driven skins when variants differ cosmetically. To manage heterogeneous row types without full subclass implementation,
  ORIG1: Reject SDUI composition for cosmetic-only variants :: Server-driven-UI engines that compose widget trees are over-engineering when all variants differ only in cosmetic skin. Violates no-speculative-abstraction rule. Use simple archetype selector field instead. Seniority is knowing when NOT to build the framework.
  ORIG2: Cosmetic vs structural axis in variant design :: Distinguish cosmetic (appearance, skin) from structural (layout, behaviour) axes when designing variant systems. If variants differ only cosmetically, a single reusable structure with content-driven skins is simpler and maintains higher visual ceiling than per-variant monolithic components.
  ORIG3: Recipe: Abstract row model with virtual defaults (RCP-ui-ux-024) :: How do we manage heterogeneous row types in a list panel without forcing every subclass to implement every property? | approach: abstract base with virtual defaults, subclasses override only what differs, composition delegates for data-rich rows | origin: lands-of-old-runtime | file: Recipes/ui-ux/a

### 69 [global] Convert Serialized Field Names to Display Strings & Enum Labels
id=e38a601959e95578 folded=2 minCos=0.852
HARD(4): RCP-monobehaviours-126 | RCP | 126 | NicifyName
soft(3): Recipes/monobehaviours/split-camelcase-enum-display-labels.md | Gaskellgames/GgCore | Recipes/editor/how-do-you-convert-a-raw-serialized-field-name.md
MERGED: To generate display labels from PascalCase/camelCase enum names, use a compiled Regex with three alternation groups: `SplitCamelCase` which avoids maintaining a string array; this regex is used in conjunction with `Enum.GetNames + Select(SplitCamelCase)` within Behavior Designer Tactical. For serialized field names (e.g., camelCase, m_prefixed), convert them to human-readable display strings by stripping the 'm_' pre
  ORIG1: Recipe: SplitCamelCase regex for enum display labels without parallel string array (RCP-monobehaviours-126) :: A single compiled Regex with 3 alternation groups splits PascalCase/camelCase to space-separated words. Enum.GetNames + Select(SplitCamelCase) builds labels automatically without a drift-prone string[]. | origin: Behavior Designer Tactical | file: Recipes/monobehaviours/split-camelcase-enum-display-
  ORIG2: Recipe: NicifyName field name to display string (RCP-editor) :: How to convert raw serialized field names (camelCase, m_prefixed) to human-readable display strings without per-repaint ObjectNames calls | approach: strip m_, insert spaces before uppercase letters, cache in static Dictionary | origin: Gaskellgames/GgCore | file: Recipes/editor/how-do-you-convert-a

### 70 [C--Fran-Voodoo-Magic] Newtonsoft.Json Requirement for Addressables and Voodoo Magic DTOs
id=5810fe624a662eb8 folded=2 minCos=0.853
HARD(4): ISO-8601 | DateTime | ISO | 8601
MERGED: Addressables 2.x no longer includes Newtonsoft.Json as a transitive dependency, requiring explicit addition via com.unity.nuget.newtonsoft-json to ensure AOT safety; previously, Addressables 1.x included it transitively. Newtonsoft.Json is used for Voodoo Magic Data Transfer Objects (DTOs) serialization because Unity's JsonUtility cannot serialize Dictionary<string,int> (clicks) or HashSet<string> (dismissed) fields 
  ORIG1: Newtonsoft is not transitive in Addressables 2.x :: Addressables 1.x brought Newtonsoft.Json as a transitive dependency, but Addressables 2.x dropped it. Must add Newtonsoft explicitly as com.unity.nuget.newtonsoft-json (the Unity-published, AOT-safe version) rather than assuming it's present.
  ORIG2: Newtonsoft.Json for Voodoo Magic DTO Serialization :: Newtonsoft.Json was selected for Voodoo Magic Data Transfer Objects (DTOs) due to Unity's JsonUtility’s inability to serialize Dictionary<string,int> (clicks) and HashSet<string> (dismissed) fields; Newtonsoft natively supports these types along with proper ISO-8601 DateTime serialization. Using Jso

### 71 [C--Fran-LLM-Workflow-Optimization] CodeGraph Staleness Handling and Incremental Rebuilds
id=42331e7cecfe099c folded=2 minCos=0.841
HARD(4): implementation_details | SHA-256 | vector_search | README
soft(2): cache_mechanism | cache_patterns
MERGED: CodeGraph uses a three-layer staleness signaling pattern: watcher + staleness banner + connect-time reconciliation for incremental consistency. Graphify utilizes SHA256 caching with a rebuild limit of ≤5 files; unchanged files are skipped using SHA256 hashing and `db_utils.is_stale()` which compares `stored_mtime` with the current mtime before calculating the hash. The local architecture resides at `C:‫ran emoved Rep
  ORIG1: Three-layer staleness signaling pattern :: CodeGraph implements reusable staleness handling: watcher + staleness banner + connect-time reconciliation. Handles incremental consistency across branch switches. Generalizable pattern for other tools.
  ORIG2: Graphify Incremental Rebuild via SHA256 Caching and CodeGraph Reference :: {"incremental_support": true, "cache_mechanism": "SHA256", "rebuild_limit": "≤5 files", "implementation_details": ["skips unchanged file reprocessing using SHA256 hashing for incremental indexing", "avoids unnecessary reprocessing using file watchers and SHA256 hashing", "file staleness determined b

### 72 [global] 2D FOV and Sprite Heading Conventions
id=997ac09696c9812d folded=2 minCos=0.823
HARD(4): transform.up | RCP | 142 | 162
MERGED: For 2D field of view (FOV) checks with sprites not facing +X, use `Vector2.SignedAngle(agentForward, dirToTarget)` where `agentForward` is the sprite's visual facing direction; ensure `Abs(angle) <= halfFov`, documented in `Recipes/monobehaviours/fov-2d-signed-angle-sprite-offset.md` at `C: ran_Unity ity-workflow-optimization`. To flip a sprite’s heading horizontally, set `localScale.x = Mathf.Sign(moveDir.x)` (±1), 
  ORIG1: Recipe: 2D FOV signed angle with sprite forward offset (RCP-monobehaviours-142) :: For 2D FOV checks when the sprite doesn't face +X: use Vector2.SignedAngle(agentForward, dirToTarget) where agentForward is the sprite's visual facing direction (e.g. transform.up for top-down). Abs(angle) <= halfFov handles any artwork convention. | origin: Behavior Designer Movement | file: Recipe
  ORIG2: Recipe: Sprite heading horizontal flip (RCP-monobehaviours-162) :: localScale.x = Mathf.Sign(moveDir.x). Sign returns ±1 (never 0). sqrMagnitude guard holds last facing when stopped. Patch only X — leave Y/Z authored. | origin: Polarith AI | file: Recipes/monobehaviours/sprite-heading-flip-horizontal.md | repo: C:\Fran\_Unity\unity-workflow-optimization

### 73 [C--Fran-LLM-Workflow-Optimization] Flow Framework Interactive Agent Consolidation & Self-Loop Guard
id=5c1c9852c373fd56 folded=3 minCos=0.811
HARD(4): needs_decision | execute.md | out_of_scope | 106
MERGED: Interactive gates use Pattern A (inline pure-interrogation agents), Pattern B (`AskUserQuestion+SendMessage-resume` resolved by the parent for blocking gates), or Pattern C (soft prompts, avoiding gate creation). Flow plugin intake agents default to Pattern A; heavy isolated work uses Pattern B. Interactive flows are defined in `flow.yaml` using type: interactive phases with loop: {condition, goto, iteration_limit}. 
  ORIG1: Interactive gates in subagents: Hybrid A/B/C approach :: (A) Inline pure-interrogation agents into parent commands. (B) Blocking gates in phase agents emit needs_decision blocks resolved by parent via AskUserQuestion+SendMessage-resume. (C) Soft prompts become documented defaults, not gates. Balances isolation, latency, responsibility. Derived from execut
  ORIG2: Intake consolidation: inline by default except heavy work :: Flow plugin intake agents should inline into parent command handlers (Pattern A). Exception: heavy isolated intake work (e.g., multi-round doubt gates) stays subagent (Pattern B) to parallelize spawning. Reduces redundant subagent overhead while preserving parallelism.
  ORIG3: Flow Framework Interactive Phases & Self-Loop Guard :: Define iterative flows in `flow.yaml` using type: interactive phases with loop: {condition, goto, iteration_limit} for machine readability and auditability; this enables harness understanding of prompt-logic loops. The flow-research-detective framework's `Pre-agent-self-loop-guard.py` incorrectly bl

### 74 [global] Grid Formation and Inspector Layout Techniques
id=c4afae75d0e1ebdd folded=3 minCos=0.72
HARD(4): RCP | 015 | 137 | 117
MERGED: Centering units in a square grid calculates column width as sqrt(unitCount), remaps unit 0 to the center column, alternates left/right placement, and uses Random.CreateFromIndex for stable per-slot jitter (Recipes/monobehaviours/centered-sqrt-grid-formation-with-deterministic-jitter.md). Distributing N agents evenly across K polygon sides utilizes the formula N/K + (N%K > i ? 1 : 0) per side (Recipes/monobehaviours/f
  ORIG1: Recipe: Centered sqrt-grid formation with deterministic jitter (RCP-monobehaviours-015) :: How do we lay out units in a square grid formation that centers from unit 0 outward and breaks visual uniformity with deterministic per-unit jitter? | approach: sqrt(unitCount) column width, unit 0 remapped to center column, others alternate left/right, Random.CreateFromIndex for stable per-slot jit
  ORIG2: Recipe: Formation floor+remainder distribution (RCP-monobehaviours-137) :: Integer floor division + per-side remainder to distribute N agents evenly across K polygon sides — avoids fractional slot counts and out-of-bounds placement. | approach: N/K + (N%K > i ? 1 : 0) per side | origin: Behavior Designer Formations | file: Recipes/monobehaviours/formation-floor-remainder-d
  ORIG3: Recipe: Multi-column struct grid inspector (RCP-editor-117) :: Cache GUILayoutOption widths as fields; header row with LabelFields; per-row BeginHorizontal + PropertyField(GUIContent.none, colWidth). Separator() acts as right-align spring. | origin: Polarith AI | file: Recipes/editor/multi-column-struct-grid-inspector.md | repo: C:\Fran\_Unity\unity-workflow-op

### 75 [global] Parallel Burst Targeting Recipe Consolidation
id=008ab5e9867250b0 folded=3 minCos=0.841
HARD(4): RCP | 026 | 038 | 064
MERGED: Distribute units evenly across building attack targets without synchronization by expanding each sub-target into a single entry and assigning units deterministically using `unitId % targetCount != targetIndex`, ensuring Burst safety; this originated in `lands-of-old-runtime` and is documented in `Recipes/dots-ecs/modulo-hash-unit-target-assignment.md` within the `C:\Fran_Unity\unity-workflow-optimization` repository.
  ORIG1: Recipe: Distribute units evenly across building attack targets via modulo hash (RCP-dots-ecs-026) :: How do we distribute units evenly across multiple attack targets on the same building without state, allocation, or synchronization? | approach: expand building into one entry per sub-target; filter with unitId % targetCount != targetIndex — each unit maps deterministically to exactly one slot, Burs
  ORIG2: Recipe: Flat-gather broadphase for N-vs-M parallel Burst targeting (RCP-dots-ecs-038) :: How to implement N-vs-M targeting in a parallel Burst job without ComponentLookup cache misses | approach: gather all target positions+metadata into flat NativeArray<T> on main thread, pass [ReadOnly] to parallel IJobEntity, each seeker scans the array; use Dispose(state.Dependency) for deferred cle
  ORIG3: Recipe: Two-pass parallel aim to avoid LocalTransform read+write conflict (RCP-dots-ecs-064) :: Split turret-aim into a gather pass (read target LocalTransform → NativeArray<float3>) then an aim pass (write turret LocalTransform from gathered positions) — eliminates Burst safety system read+write conflict when both queries use LocalTransform. | origin: IntoTheEndlessSea | file: Recipes/dots-ec

### 76 [global] Perceptually Linear Scale Fade and GradientMode Versioning
id=bcc6c09b0f088ce8 folded=2 minCos=0.834
HARD(4): RCP-ui-ux-001 | RCP | 001 | 078
MERGED: To achieve perceptually linear scale fade, apply `Mathf.Sqrt(Mathf.Clamp01(fade))` to the normalized fade parameter, compensating for perceptual bias; this originates from `lands-of-old-runtime` and is documented in `Recipes/ui-ux/sqrt-scale-fade-perceptual-easing.md` within `C:\Fran_Unity\unity-workflow-optimization`. For Unity 2021 LTS and Unity 2022.3+ compatibility, wrap GradientMode selection in a `#if UNITY_202
  ORIG1: Recipe: How do we apply a scale-based fade transition that feels perceptually linear? (RCP-ui-ux-001) :: How do we apply a scale-based fade transition that feels perceptually linear instead of snapping in fast then crawling to completion? | approach: apply Mathf.Sqrt(Mathf.Clamp01(fade)) to the normalized fade parameter before scaling, compensating for perceptual bias where linear scale changes feel ac
  ORIG2: Recipe: GradientMode.PerceptualBlend version guard for Unity 2021/2022 LTS compatibility (RCP-editor-078) :: Wrap GradientMode selection in #if UNITY_2022_3_OR_NEWER to use PerceptualBlend on 2022.3+ and fall back to Blend on 2021 LTS, keeping one source file compatible with both LTS versions. | origin: Hierarchy Designer | file: Recipes/editor/gradient-mode-perceptualblend-version-guard.md | repo: C:\Fran

### 77 [global] Safe Entity Removal and Missing Script Cleanup
id=07b845762c420222 folded=2 minCos=0.865
HARD(4): RCP | 016 | API | 103
MERGED: To safely remove entities, mark them with `IsMarkedForRemoval` and flush marked entities in a `LateGameComponentGroup` tick (origin: lands-of-old-runtime, file: Recipes/monobehaviours/mark-and-flush-deferred-removal.md, repo: C:‫ran_Unityity-workflow-optimization). For programmatic removal of null-script components, use `GameObjectUtility.RemoveMonoBehavioursWithMissingScript` wrapped in `Undo.RecordObject`, and recu
  ORIG1: Recipe: How do we safely remove entities during gameplay without mid-iteration deletion bugs? (RCP-monobehaviours-016) :: How do we safely remove entities during gameplay without mid-iteration deletion bugs? | approach: mark entities with IsMarkedForRemoval during gameplay, flush all marked entities in a LateGameComponentGroup tick after all gameplay logic completes | origin: lands-of-old-runtime | file: Recipes/monobe
  ORIG2: Recipe: GameObjectUtility.RemoveMonoBehavioursWithMissingScript (RCP-editor-103) :: Use GameObjectUtility.RemoveMonoBehavioursWithMissingScript to remove null-script components programmatically. Wrap in Undo.RecordObject; recurse via GetComponentsInChildren<Transform>(true) for full hierarchy cleanup. | approach: official API + recursive traversal | origin: MagicPig Shared | file: 

### 78 [global] Dual Project Prefs Routing
id=d5c45f7841583008 folded=2 minCos=0.887
HARD(4): MagicPig | API | RCP | 110
MERGED: The DualPrefs static wrapper, defined in Recipes/monobehaviours/dual-editor-player-prefs.md within the C:\Fran\_Unity\unity-workflow-optimization repository, uses #if UNITY_EDITOR to route calls to EditorPrefs during development and PlayerPrefs in builds, allowing callers to avoid conditional compilation. ProjectPrefs, implemented in Snippets/editor/ProjectPrefs.cs (also in C:\Fran\_Unity\unity-workflow-optimization)
  ORIG1: Recipe: DualPrefs — single API routing to EditorPrefs or PlayerPrefs by context (RCP-monobehaviours-110) :: Static DualPrefs wrapper uses #if UNITY_EDITOR to route to EditorPrefs (survives domain reloads) or PlayerPrefs (survives builds). Callers have no #if guards. | approach: single static wrapper with compile-time routing | origin: MagicPig Shared | file: Recipes/monobehaviours/dual-editor-player-prefs
  ORIG2: Snippet: ProjectPrefs (BP-editor-021) :: ProjectPrefs wraps EditorPrefs to scope every key per-project via PlayerSettings.productGUID.GetHashCode(), preventing cross-project setting bleed. Uses productGUID (stable across folder moves) not dataPath. | implements BP-editor-021 | file: Snippets/editor/ProjectPrefs.cs | repo: C:\Fran\_Unity\un

### 79 [global] Batching Large Codebases for Parallel Processing & Pattern Extraction
id=40f1cdd149988a46 folded=2 minCos=0.885
HARD(4): git status | PowerShell | 200 | 135
MERGED: Large features exceeding 30 tasks or codebases larger than 270 files/30 nested entries require batching; Glob patterns truncate output, requiring `Get-ChildItem -Recurse` and path verification. ProjectDawn.Navigation was batched into 12 domain groups (SystemGroups, SpatialPartitioning, Steering, Locomotion, NavMesh, Editor). To prevent memory bloat during pattern extraction, group source files by immediate parent fol
  ORIG1: Large Codebase Pattern Extraction Workflow :: When using Glob patterns on codebases exceeding 270 files or 30 nested entries, output is silently truncated; use `Get-ChildItem -Recurse` (PowerShell) for complete enumeration and verify directory existence with `git status` or explicit path checks before destructive operations. To prevent memory b
  ORIG2: Batch Large Features/Codebases for Parallel Processing :: Large features exceeding approximately 30 tasks should be split into batches respecting dependency order to enable incremental execution and checkpointing while maintaining visibility; similarly, when analyzing large code packages (135+ files), group files by folder structure and domain before paral

### 80 [global] Unity Asset Management and API Renames
id=612cda9628522760 folded=2 minCos=0.875
HARD(4): DestroyImmediate(child, true | DestroyImmediate | git mv | AssetUsageDetector
soft(3): Recipes/editor/how-do-you-isolate-a-unity-api-type-rename.md | Recipes/editor/how-do-we-inject-ui-into-a-unity-built-in-editor-window.md | Fran_Unity
MERGED: Isolate Unity API type renames using `#if` aliases; handle `AccessTools.TypeByName` null returns with null guards; inject HarmonyPostfix after Unity's method; test across all Unity versions. Rename `.asset` files require manual synchronization of the internal `m_Name` YAML field via regex or Python scripts at `C: ran_Unity ity-workflow-optimization`. Defer `ImportAsset` calls from `OnPostprocessAllAssets` using `Edit
  ORIG1: Unity Editor Asset Loading and Postprocessing Conventions :: Defer `ImportAsset` calls from `OnPostprocessAllAssets` using `EditorApplication.delayCall`. Defer `AssetDatabase` load/move in `AssetModificationProcessor.OnWillCreateAsset`. Avoid direct `AssetDatabase`/`EditorWindow` API calls within `[InitializeOnLoad]` static constructors; enqueue a delayCall l
  ORIG2: Unity API Renames, Harmony Patching, and Asset Name Synchronization :: Isolate Unity API type renames using file `#if` aliases; all call sites must use the alias unconditionally (Recipes/editor/how-do-you-isolate-a-unity-api-type-rename.md, AssetUsageDetector). Handle `AccessTools.TypeByName` null returns with null guards and inject HarmonyPostfix after Unity's method 

### 81 [global] Claude MCP Server Configuration and Persistence
id=15b541e81f3fd24b folded=2 minCos=0.925
HARD(4): mcp__[server-name]__ | mcp__ | SQLITE_BUSY | WAL
MERGED: MCP server approvals are context-dependent between the Claude CLI (`claude`) and CCD/desktop sessions; approval in one session does not persist to others or affect `~/.claude.json`. Configuration files like `.claude.json` (CLI) and `~/.config/Claude/claude_desktop_config.json` (Linux) / `AppData\Roaming\Claude\claude_desktop_config.json` (Windows), along with `.mcp.json` at the repository root, require a full applica
  ORIG1: Claude MCP Server Approvals and Configuration Persistence :: MCP server approvals are context-dependent, with interactive Claude CLI (`claude`) and CCD/desktop sessions maintaining separate approval flows; approving a server in one session (e.g., `claude`) may not persist to the other or affect ~/.claude.json. MCP connections initialize at session start, prev
  ORIG2: Claude Code MCP Configuration Behavior :: The Claude Desktop application uses `~/.config/Claude/claude_desktop_config.json` (Linux) or `AppData\Roaming\Claude\claude_desktop_config.json` (Windows), while the CLI utilizes `~/.claude.json`, and both interact with `.mcp.json`; changes to any of these files require a full application restart to

### 82 [C--Fran-Voodoo-Magic] Event Data Architecture and Migration
id=52927b7fce5efce9 folded=2 minCos=0.827
HARD(4): EventIconView/EventPopup | LocalizedText | EventIconView | EventPopup
MERGED: Event IDs and theme labels in `worker/seed-events.json` are decoupled from code, enabling renaming without modification; the event shape (prefabKey, themeLabel, icon) is defined in the Worker and consumed by code. The `/events` endpoint supports legacy bare arrays and `{serverTime, events}` for migration to a single-source structure. Server-authored JSON at `Assets/StreamingAssets/events.json` defines events with pro
  ORIG1: Event data decoupled from event shape :: Event IDs and theme labels in seed-events.json can be renamed without code changes. The event shape (prefabKey, themeLabel, icon, etc.) is defined in the Worker and consumed by code, but seed data is flexible for art direction and content updates.
  ORIG2: /events Endpoint and Event Data Architecture :: The `/events` endpoint in the Worker now handles both legacy bare arrays and the new `{serverTime, events}` format to support migration; this bridges the old format with the single-source structure. Server-authored JSON at `Assets/StreamingAssets/events.json` defines events with properties including

### 83 [global] ECS Singleton Management and Consumption
id=8900def0202d2667 folded=3 minCos=0.857
HARD(4): RCP | 009 | 014 | 016
MERGED: To atomically consume a one-time ECS singleton event, use `TryConsumeNotification<T>()` (file: `Recipes/dots-ecs/singleton-notification-consume-and-remove.md`). Accessing managed (`Singleton<T>.Get()`) and ECS (`SystemAPI.GetSingletonRW<T>().ValueRW`) singletons within a system update requires a non-Burst-compiled `SystemBase.OnUpdate` method guarded by a `ManagedWorldInitializedTag RequireForUpdate` (file: `Recipes/
  ORIG1: Recipe: Generic ECS singleton notification consumption (RCP-dots-ecs-009) :: How do we consume a one-time ECS singleton event/notification exactly once and remove it atomically? | approach: generic TryConsumeNotification<T>() reads and removes a singleton IComponentData in one call; caller checks bool return | origin: lands-of-old-runtime | file: Recipes/dots-ecs/singleton-n
  ORIG2: Recipe: Deferred singleton creation in OnUpdate (RCP-dots-ecs-014) :: How do we create an ISystem singleton lazily in OnUpdate to avoid dependency ordering deadlocks during OnCreate? | approach: TryGetSingleton guard in OnUpdate + RequireForUpdate in OnCreate ensures dependency singleton exists before creation attempt; attach via AddComponentData(state.SystemHandle, s
  ORIG3: Recipe: How do we access both a managed singleton and an ECS singleton in the same system update? (RCP-dots-ecs-016) :: How do we access both a managed singleton and an ECS singleton in the same system update, mutating the ECS side, without needing two separate systems? | approach: Use managed SystemBase.OnUpdate — not Burst-compiled — to call both Singleton<T>.Get() and SystemAPI.GetSingletonRW<T>().ValueRW in one m

### 84 [global] Rigidbody Alignment & Physics Stability
id=c662513a3259eacc folded=2 minCos=0.74
HARD(4): PhysicsMass.Transform.rot | math.mul | PhysicsMass | InertiaTensor
MERGED: Align Rigidbody smoothly using physics torque: calculate `deltaRot = targetRot * Quaternion.Inverse(rb.rotation)`, convert to axis-angle, scale by stiffness, clamp magnitude, apply with `rb.AddTorque`. For controller input driving physics, use Roll, Pitch, and Yaw fields applying `AddRelativeTorque` or `AddForce`, scaled by body mass (Recipes/physics/quaternion-delta-torque-surface-alignment.md, Recipes/physics/contr
  ORIG1: Unity Physics NaN propagation from uninitialized quaternions and invalid inertia :: default(quaternion) and PhysicsMass.Transform.rot initialize to (0,0,0,0), not identity; normalizing (0,0,0,0) produces NaN that infects positions via math.mul(NaN_quaternion, float3). Always explicitly set InertiaOrientation = quaternion.identity. Zero-valued InverseInertia or InertiaTensor compone
  ORIG2: Quaternion Delta Torque & Euler Storage for Physics Alignment :: To smoothly align a Rigidbody to a target orientation each frame using physics torque, compute `deltaRot = targetRot * Quaternion.Inverse(rb.rotation)`, convert this quaternion delta to an axis-angle representation, scale the resulting vector by a stiffness value, clamp its magnitude, and apply it a

### 85 [global] NavMesh Agent Pathfinding and Recovery
id=2ee16ca2e630ab9f folded=2 minCos=0.872
HARD(4): and false by | prevents premature | returns; its absence causes | before calling
soft(2): bool in BP-monobehaviours-031, set to true by | C:	ran_Unity
ity-workflow-optimization
MERGED: A NavMeshAgent's `HasArrived()` spuriously returns true after `SetDestination()` without prior pathfinding; guard with `!agent.pathPending && agent.remainingDistance < threshold && !agent.hasPath`. The local `destinationSet` bool (BP-monobehaviours-031) tracks destinations set via `SetDestination()` or cleared via `Stop()`. Validate wander candidate positions with `NavMesh.SamplePosition(candidate, out hit, agent.hei
  ORIG1: NavMeshAgent Arrival and Wander Destination Validation :: NavMeshAgent's `HasArrived()` returns true spuriously on the first frame after `SetDestination()` if a destination is assigned without prior pathfinding; guard `HasArrived()` with `!agent.pathPending && agent.remainingDistance < threshold && !agent.hasPath`. The local `destinationSet` bool in BP-mon
  ORIG2: NavMesh Agent Recovery and Spawn Clearance :: To detect NavMesh holes after `SetDestination`, check if `(slotPos - agent.pathEndPosition).sqrMagnitude > 0.5f`; if true, retry once with a reachable proxy and set the `destinationPending` flag to prevent repeated retries. Flush-wall spawns are prevented using a two-pass NavMesh clearance recipe: P

### 86 [global] EditorTool Discovery, Icon Caching, and Target Injection
id=90b636675e70572c folded=3 minCos=0.821
HARD(4): RCP | 094 | SetActiveTool | 095
MERGED: At editor initialization ([InitializeOnLoad]), enumerate non-abstract EditorTool subclasses using reflection to cache toolbar icons by FullName, skipping Sirenix assemblies (file: Recipes/editor/editortool-subclass-discovery-icon-cache-initializeonload.md, repo: C:‫ran_unityity-workflow-optimization). To set an EditorTool's target before activation, write to the private m_Target and m_Targets fields via cached FieldI
  ORIG1: Recipe: EditorTool subclass discovery + icon cache at domain load (RCP-editor-094) :: Enumerate all non-abstract EditorTool subclasses at [InitializeOnLoad] time, temporarily CreateInstance to read toolbarIcon then DestroyImmediate, cache by component type FullName. Skip Sirenix assemblies. | approach: reflection + transient CreateInstance per tool type | origin: CoInspector | file: 
  ORIG2: Recipe: Inject EditorTool target via m_Target reflection before SetActiveTool (RCP-editor-095) :: Set an EditorTool's target before activating it by writing to private m_Target and m_Targets fields via reflection — there is no public setter on EditorTool base class. Cache FieldInfo after first lookup. | approach: cached field reflection, set both m_Target and m_Targets | origin: CoInspector | fi
  ORIG3: Recipe: TypeCache auto-discovery for extensible editor systems (editor) :: TypeCache.GetTypesDerivedFrom<T>() (Unity 2019.2+) auto-instantiates all concrete interface implementations at editor startup — no manual registration. Distinguish internal vs external by namespace comparison. Origin: CodeStage/Maintainer. File: Recipes/editor/how-do-we-auto-discover-and-instantiate

### 87 [global] Hybrid ECS State Management & Lifecycle
id=9d610b3ab923cc22 folded=2 minCos=0.896
HARD(4): OnDisable( | IntoTheEndlessSea | ComponentStateReset | OnDisable
soft(5): (RCP-monobehaviours-007) and | (RCP-dots-ecs-001), located in the repository at | Snippets/dots-ecs/ComponentStateReset.cs | Recipes/dots-ecs/cleanup-buffer-orphaned-child-destruction.md | Recipes/dots-ecs/dynamic-buffer-entity-reuse-before-instantiate.md
MERGED: Separate entity state and visualization initialization using `InitializeEntity()` for game state and `InitializeVisualization()` for visual binding, followed by an ECS bridge event. Managed code aggregates ECS entity state via injected `IEntityCache` using `GetEntities<TBridgeType>(key)` to avoid direct ECS World access (Recipes/monobehaviours-entity-state-vs-visualization-init-phases.md - RCP-monobehaviours-007, Rec
  ORIG1: Hybrid ECS State Initialization and Aggregation :: To separate entity state initialization from visualization state initialization in a hybrid managed/ECS system, split creation into `InitializeEntity()` (game state only) and `InitializeVisualization()` (visual binding only), then fire an ECS bridge event after both. Managed code aggregates ECS enti
  ORIG2: ECS Entity Lifecycle Management & Synchronization :: To prevent stale component states when an entity is despawned and respawned, implement an explicit `Reset()` method in `IComponentData` (BP-dots-ecs-020, file: Snippets/dots-ecs/ComponentStateReset.cs); frame-rate-independent spawn timers can be implemented using a singleton `ISystem` that stores a 

### 88 [global] C# Type Resolution, FQDN Generation, and Partial Class Merging
id=263dd083de469ca1 folded=2 minCos=0.793
HARD(4): GetTypes( | GetTypes | Dictionary<Type,string> | SemanticModel
soft(2): Type.GetType(FullName | Recipes/editor/type-name-cs-syntax-cached-formatter.md
MERGED: Generate fully-qualified type names (FQDNs) without a semantic model by traversing syntax tree ancestors, filtering for `NamespaceDeclarationSyntax` and `TypeDeclarationSyntax`, extracting identifiers, reversing them, and handling `FileScopedNamespaceDeclarationSyntax`. Merging partial class syntax trees—as described in `Recipes/editor/how-do-we-merge-multiple-partial-class-syntax.md`—relies on FQDN generation for Fa
  ORIG1: Assembly Type Resolution and Serialization :: Enumerating assemblies with `AppDomain.GetAssemblies()` requires deduplication by `FullName` to avoid `ArgumentException` when creating a dictionary; use `GroupBy(t => t.FullName).Select(g => g.First())`. For type serialization across assembly boundaries, utilize `Type.AssemblyQualifiedName` because
  ORIG2: Fully-Qualified Name Generation and Partial Class Merging in C# :: To build fully-qualified type names, walk the syntax tree's ancestors, filtering for `NamespaceDeclarationSyntax` and `TypeDeclarationSyntax`, extracting identifiers and reversing them to construct the FQDN without a semantic model; this process must handle `FileScopedNamespaceDeclarationSyntax` (C#

### 89 [global] LayerMask Handling and Binding Conventions
id=f608b276e3480289 folded=2 minCos=0.85
HARD(4): API | in any assembly; conversely, | Gaskellgames/GgCore | GgCore
MERGED: LayerMask exposes raw bitmasks; utilities like LayerMaskToLayers, LayerToLayerMask (1<<layer), and IsLayerInLayerMask handle per-layer logic. ProjectileSpawner.SetLayerOfProjectile and projectileLayer store LayerMask bitmasks; use LayerMask.GetMask("LayerName") or 1 << LayerMask.NameToLayer("LayerName") instead of raw indices like 8, which incorrectly sets layer 3 (bit-position). This convention originates from Proje
  ORIG1: LayerMask Handling Conventions and Utilities :: LayerMask exposes raw bitmasks; a built-in API to enumerate included layers is absent, necessitating LayerMaskToLayers (iterates bits, collects indices), LayerToLayerMask (1<<layer), and IsLayerInLayerMask (bitwise AND test) utilities for per-layer logic. EditorGUI.MaskField returns a dense display-
  ORIG2: LayerMask.LayerToName vs. InternalEditorUtility.layers and LayerField Binding :: The `LayerMask.LayerToName` enumeration functions at runtime, allowing listing of defined layers using `Enumerable.Range(0,32).Select(LayerMask.LayerToName).Where(n=>!string.IsNullOrEmpty(n))` in any assembly; conversely, `InternalEditorUtility.layers` is editor-only and fails to compile in builds. 

### 90 [global] ECS and IL2CPP Component Management Best Practices
id=badf5b0d31c74879 folded=3 minCos=0.765
HARD(4): AssetReference | Dependency.Complete( | CopyTo | Dependency.Complete
soft(2): Recipes/monobehaviours/getcomponent-typeof-interface-il2cpp-safe.md | Knowledge/performance/filter-interface-implementing-components-without.md
MERGED: For IL2CPP managed code stripping on iOS/Android/console, use `GetComponent(typeof(T)) as T` instead of `GetComponent<interface>` to avoid silent null returns. Component filtering should utilize `Component.GetComponents(List<T>)` with a persistent buffer and an 'is IInterface' filter loop, replacing allocating `GetComponents<T>()`. When adding components programmatically, use `SetComponent` for existing entities and 
  ORIG1: IComponentData Performance and Restrictions :: Migrating `IComponentData` to an unsafe struct improves performance via direct Burst pointer access (blittable structs avoid safety indirection) and chunk-resident storage, reducing GC heap fragmentation; this explains `DD2D_AlphaMaskComponent`'s superior performance over its managed class counterpa
  ORIG2: IL2CPP-Safe GetComponent and Non-Alloc Component Filtering :: For IL2CPP managed code stripping on iOS/Android/console, use `GetComponent(typeof(T)) as T` instead of the generic `GetComponent<interface>`, which can silently return null. To avoid allocations when filtering components implementing an interface, utilize `Component.GetComponents(List<T>)` with a p
  ORIG3: ECS Component Management and Dependencies :: Use `SetComponent` for existing entities and `AddComponent` for new ones (RCP-dots-ecs-020). Unused IComponentData fields consume chunk memory; orphaned serialized fields persist in .asset files upon config field removal. `ComponentLookup<T>.HasComponent` provides an allocation-free, Burst-safe meth

### 91 [global] GOAP Planning System Optimization
id=55a960bdea695d31 folded=3 minCos=0.754
HARD(4): IsLowHealth → heal | IsLowHealth | respectively, all within the repository at | CPU
soft(1): Recipes/monobehaviours/goap-astar-planner-admissible-heuristic-caps.md
MERGED: Inject behavior into GOAP actions at runtime using the `DynamicAction` class with delegate fields (`preconditionMet`, `applyEffect`, `execute`, `interrupt`) for delegate swapping (Recipes/monobehaviours/goap-delegate-injectable-dynamic-action.md). Instantiate GOAP actions at runtime using `GOAPActionFactory.Create<T>()`, which calls `AddComponent<T>()` on the agent's GameObject and returns a typed reference, creating
  ORIG1: GOAP Dynamic Action & Goal System :: To inject behavior into GOAP actions at runtime without subclassing, use a `DynamicAction` class with delegate fields (`preconditionMet`, `applyEffect`, `execute`, `interrupt`) allowing action variety through delegate swapping; this approach originates from Synaptic AI Pro (file: Recipes/monobehavio
  ORIG2: GOAP Planner with Admissible Heuristic, Three-Phase Actions, and N-Scaled Rejection Sampling :: To optimize GOAP planning, implement an admissible A* heuristic by counting unsatisfied goal conditions as `h(n)`, ensuring optimality because each condition requires at least one action. Actions should utilize a three-phase lifecycle: `OnEnter`, `OnTick`, and `OnExit`, with the planner triggering `
  ORIG3: Performance Optimization Techniques & Action Registry :: Implement a priority-sorted action registry using a `List<(priority,action)>` sorted descending alongside a `Dictionary<handle,action>` with integer handles for O(1) deregistration; registration returns an integer handle and the pattern originates from `lands-of-old-runtime`, `FastScriptReload`, and

### 92 [global] Project and Hierarchy Window GUI Hook Versioning and Decoration
id=9d4b456f855ff422 folded=3 minCos=0.797
HARD(4): gridSnapEnabled | CoInspector | API | IMGUI
MERGED: The Project Window's `projectWindowItemOnGUI` (string GUID), `projectWindowItemInstanceOnGUI` (int instanceID, introduced in 2022.1), and `projectWindowItemByEntityIdOnGUI` (EntityId, introduced in 6000.4) callbacks require compile-time guards (#if UNITY_6000_4_OR_NEWER, elif UNITY_2022_1, else) for registration, always unsubscribing (−=) before subscribing (+=); asset status indicators are drawn using `EditorGUI.Dra
  ORIG1: Project Window GUI Hook API and Version Guards :: The Project window's IMGUI hook API changed across three Unity generations, requiring compile-time guards for callback registration. Pre-2022 used `EditorApplication.projectWindowItemOnGUI` (string GUID), 2022.1+ uses `projectWindowItemInstanceOnGUI` (int instanceID), and 6000.4+ uses `projectWindow
  ORIG2: Project Window Asset Status Indicators and View Detection :: The `ProjectWindowIconVsListViewDetect` snippet (file: Snippets/editor/ProjectWindowIconVsListViewDetect.cs, repo: C: extbackslash Fran_\Unity\unity-workflow-optimization) detects icon vs list view in the Project Window within `projectWindowItemOnGUI` by checking if `selectionRect.height > 20`, exte
  ORIG3: Hierarchy Window and Project Drag & Drop Handling Conventions :: During Repaint, the Hierarchy Designer records header row Y ranges and scene indices into a `List<RowAnchor>`, cleared on `EventType.Layout`, enabling Y-based scene index lookup during clicks; prefab roots redirect scene-view clicks via the `[SelectionBase]` attribute without affecting panel selecti

### 93 [C--Fran-Automatic-Encyclopedias] Category Assignment Standards and Evaluation
id=936e8d3be85a310c folded=2 minCos=0.85
HARD(3): fabricated=true | 0.0 | 1.0
MERGED: The `category_correct` field is evaluated independently of faithfulness, depth, and fabrication scores; an entry can have high quality metrics but still be incorrectly categorized due to imperfect category alignment. Category assignment requires a 'defensible fit' standard where the entry serves readers within the assigned category, allowing for multiple reasonable fits. Category validation is a hard constraint, defa
  ORIG1: Category fit independent of content quality :: The category_correct field is evaluated independently from other quality metrics. An entry can score high on faithfulness, depth, and fabrication while category_correct is false because the assigned category poorly matches the entry's focus—especially when allowed categories don't have a perfect fit
  ORIG2: Category Assignment Standards :: When assigning encyclopedia entries to categories, utilize a 'defensible fit' standard where the entry serves readers within that category, even if perfect categorical alignment isn't possible; multiple defensible fits are permitted and considered correct if reasonable. Category validation is a hard

### 94 [C--Fran-LLM-Workflow-Optimization] MCP Pre-Flight Phase Removal & Flow Restructuring
id=0182fc8a841a2d9e folded=2 minCos=0.794
HARD(3): v1.3.0 | 3.0 | API
MERGED: The MCP pre-flight phase, which included HTTP 500ms probes for server health, hook registration checks, and agent tools allowlist verification – intended for Phase 0 flows – has been removed due to redundancy with the analyze validation's Python availability and tool script path checks. The intake.json existence check will now be incorporated into the first step of the analyze agent. This eliminates one agent spawn p
  ORIG1: flow-book-encyclopedia v1.3.0 phase restructuring :: Preflight agent removed; route phase inserted between intake and analyze. Route phase fans out into parallel 4-group batches. Intake reads encyclopedias-manifest.json (not 21 separate files).
  ORIG2: MCP Pre-Flight Phase Redundancy :: Pre-flight checks, including MCP server health (HTTP 500ms probe), hook registration, and agent tools allowlist verification, previously ran as pure Python to reduce startup latency and avoid cold-start API costs; these were intended for Phase 0 in flows. However, the preflight phase's validation of

### 95 [C--Fran-Voodoo-Magic] Gameplay & UI Animation Tuning Conventions
id=dfea0e33a3f49368 folded=2 minCos=0.849
HARD(3): HeroStarPulse | CloudDrift | SFX
soft(2): C:\Fran_Unity\unity-workflow-optimization\Knowledge | Fran_Unity
MERGED: Gameplay timing parameters are inspector fields with defaults of 0.6s; animation features expose configurable duration and easing parameters for visual positioning accuracy and responsiveness. UI animation components expose [SerializeField] properties including tint color, rotation speed, and pulse amount for per-theme tuning in the Inspector. Project grading emphasizes architecture, C#/edge-cases, and polish, allowi
  ORIG1: Splash Screen Architecture & UI Animation Conventions :: Engineering design decisions must be grounded in rationale, referencing the project brief for requirements like Play button functionality and counter increments; visual identity prioritizes layout, typography, framing, palette, and motion over strict theme adherence to focus on system architecture a
  ORIG2: Gameplay & UI Animation Tuning Conventions :: Gameplay timing parameters, such as card reveal delays, are exposed as inspector fields with defaults of 0.6s for designer tuning; animation features expose configurable duration and easing parameters intended for playtesting-based adjustments to visual positioning accuracy and responsiveness. UI an

### 96 [global] 8-Direction Steering with Love/Hate Priority & Signed Angle Calculation
id=55db1b8324222460 folded=2 minCos=0.864
HARD(3): RCP | 023 | 024
MERGED: Implement 8-direction steering force accumulation by decomposing heading into eight octants, storing love/hate per-octant as float4 pairs; subtract hate from love and clamp the result. Sum weighted direction vectors for each octant, capping magnitude to 1 when exceeded, originating from `lands-of-old-runtime` in file `Recipes/dots-ecs/octant-steering-love-hate-priority.md` within repo `C:ran_Unityity-workflow-optimiz
  ORIG1: Recipe: 8-direction steering force accumulation with hate/love priority (RCP-dots-ecs-023) :: How do we implement 8-direction steering force accumulation with hate/love priority? | approach: decompose heading into 8 octants, store love/hate per-octant as float4 pairs, subtract hate from love then clamp, sum weighted direction vectors, cap magnitude to 1 only when exceeded | origin: lands-of-
  ORIG2: Recipe: Signed steering angle from cross product Y (RCP-physics-024) :: steerInput = -Vector3.Cross(decidedDir, transform.forward).y. Y-component of XZ cross product gives signed sin(θ). No Atan2, no branch, linear for small angles. | origin: Polarith AI | file: Recipes/physics/signed-steering-angle-cross-product.md | repo: C:\Fran\_Unity\unity-workflow-optimization

### 97 [global] Spline Validation Centers and Cutting with Health Preservation
id=1ab8c6003a33c7e5 folded=2 minCos=0.83
HARD(3): RCP | 024 | 041
MERGED: Validation centers are distributed evenly along a spline by dividing arc length by `2*radius` and placing one center per step using normalized t, offset by half-step for symmetry; this originates in `lands-of-old-runtime` (documented in `Recipes/monobehaviours/spline-even-interval-validation-centers.md` at `C: ran_Unity ity-workflow-optimization`). Spline cutting uses `GetNearestPoint` to find t-values, then `CutSpli
  ORIG1: Recipe: Spline even-interval validation centers (RCP-monobehaviours-024) :: How do we distribute validation centers evenly along a spline so that coverage is guaranteed with no overlaps and no gaps? | approach: divide arc length by 2*radius, place one center per step using normalized t, offset by half-step for symmetry | origin: lands-of-old-runtime | file: Recipes/monobeha
  ORIG2: Recipe: Spline cutting with health preservation across wall segments (RCP-monobehaviours-041) :: How do we cut a spline at two parameter values and preserve per-segment health data proportionally across the resulting left and right sub-walls? | approach: use GetNearestPoint to find t-values, CutSpline to split, then copy health from head for left wall and from tail (reversed) for right wall | o

### 98 [global] IMGUI Exception Handling & Reflection Workarounds
id=ecd76b3b0dda8476 folded=3 minCos=0.86
HARD(3): CoInspector | HostView | EditorWindows
soft(1): HostView.m_OnGUI
MERGED: Wrap each IMGUI panel's `draw(rect)` call in a try/catch block; log exceptions and paint a HelpBox on repaint to prevent global layout corruption. Panel exception isolation prevents cascading failures to the GUILayout stack. When invoking reflected `Editor.OnHeaderGUI` methods (RCP-editor-099, `Recipes/editor/exitguiexception-defer-reflected-ongui-invocation.md`), use a dual catch block for `TargetInvocationException
  ORIG1: Recipe: ExitGUIException handling in reflected OnHeaderGUI invocation (RCP-editor-099) :: Wrap reflected Editor.OnHeaderGUI invocations in try/catch for TargetInvocationException(inner=ExitGUIException) and ExitGUIException directly — silently return on either. Re-throwing corrupts the IMGUI layout stack. | approach: dual catch, silent return on ExitGUI, log any other inner exception | o
  ORIG2: Exception isolation in IMGUI panel render prevents layout corruption :: Wrap each panel's draw(rect) in try/catch, log exception and paint HelpBox on repaint. Uncaught exceptions corrupt global GUILayout stack, breaking layout for all subsequent panels; isolation prevents cascade.
  ORIG3: Recipe: Replace sealed EditorWindow OnGUI delegate via reflection (vHierarchy) :: Replace HostView.m_OnGUI delegate via reflection to prepend/append UI to sealed internal EditorWindows; unwrap TargetInvocationException so ExitGUIException propagates normally; re-wrap after domain reload and unmaximize. | origin: vHierarchy | domain: editor | repo: C:\Fran\_Unity\unity-workflow-op

### 99 [global] Two-Phase Priority-Bucketed Worker Allocation with Diminishing Returns Scaling
id=f2ee177fd5696a0d folded=2 minCos=0.867
HARD(3): RCP | 005 | 019
MERGED: To allocate limited workers across multiple pending tasks, track available workers and clamp consumed workers per task while scaling time progress by consumedWorkers/fullSpeedWorkerCount (file: Recipes/monobehaviours/worker-pool-diminishing-returns-scaling.md, repo: C:\ran_Unityity-workflow-optimization). Prioritized jobs use a two-phase allocation: Phase 1 iterates priorities high-to-low calling AllocateWorkersToJob
  ORIG1: Recipe: Worker pool diminishing returns scaling (RCP-monobehaviours-005) :: How do we allocate limited workers across multiple pending tasks so progress scales with workers assigned without starving remaining tasks or overallocating? | approach: track availableWorkers pool, clamp consumed per task, scale time progress by consumedWorkers/fullSpeedWorkerCount, return residual
  ORIG2: Recipe: Two-phase priority-bucketed worker allocation (RCP-monobehaviours-019) :: How do we allocate limited workers across prioritized jobs so that high-priority jobs get first pick and workers are distributed fairly within each priority level? | approach: Phase 1 iterates priorities high-to-low calling AllocateWorkersToJobs (greedy with evaluation function (allocated<<16)/neede

### 100 [global] Two-Key Stable Sort and Deterministic Insertion Sort
id=f65599ba90746867 folded=2 minCos=0.887
HARD(3): RCP | 012 | 040
MERGED: For stable, deterministic ordering with two keys, compare the primary key first; if equal, use a stable unique secondary key (e.g., persistent ID) to prevent reordering of equal elements—originating from `lands-of-old-runtime` in file `Recipes/monobehaviours/two-key-stable-sort.md`, located at repository `C: ran_Unity ity-workflow-optimization`. When `List<T>.Sort()` causes flickering UI or non-reproducible order, co
  ORIG1: Recipe: How do we implement a two-key sort for stable, deterministic ordering? (RCP-monobehaviours-012) :: How do we implement a two-key sort for stable, deterministic ordering? | approach: compare primary key first; if equal, compare a stable unique secondary key (e.g. persistent ID) to prevent arbitrary reordering of equal elements | origin: lands-of-old-runtime | file: Recipes/monobehaviours/two-key-s
  ORIG2: Recipe: Stable insertion sort for deterministic list ordering (RCP-performance-040) :: IList<T> insertion sort that is stable (equal elements never reorder). Use when List<T>.Sort() produces flickering UI or non-reproducible order. O(n²) worst-case, O(n) for nearly-sorted. | origin: UltEvents/UltEventUtils.cs | file: Recipes/performance/stable-insertion-sort-deterministic-ui-ordering.

### 101 [global] Leapfrog Sync and Formation Pending List Distance Sort
id=edead1d2cf236578 folded=2 minCos=0.873
HARD(3): RCP | 118 | 135
MERGED: Leapfrog synchronization uses a leader-owned `List<bool> agentReady` array; followers call `UpdateReadyState(index, true)` upon arrival at the leader. The leader swaps groups, signals the idle group, and resets `agentReady` flags (Recipes/monobehaviours/leapfrog-leader-ready-state-array.md). Formation joining is deferred to a pending list until formation start; then agents are sorted by distance-to-destination using 
  ORIG1: Recipe: Leapfrog two-group sync via leader-owned ready-state array (RCP-monobehaviours-118) :: Leader maintains List<bool> agentReady; followers send UpdateReadyState(index, true) on arrival. When all are ready, leader flips groups, signals idle group, resets ready flags. | origin: Behavior Designer Tactical | file: Recipes/monobehaviours/leapfrog-leader-ready-state-array.md
  ORIG2: Recipe: Formation pending list distance sort (RCP-monobehaviours-135) :: Defer joining agents to a pending list until formation starts, then sort by distance-to-destination using System.Array.Sort(keys,values) — closest agent becomes leader (index 0) regardless of registration order. | approach: pending list + BCL parallel sort at formation start | origin: Behavior Desig

### 102 [global] Per-Frame RNG Seeding and Allocation-Free Rolling Average
id=2e9740188fe61463 folded=2 minCos=0.795
HARD(3): RCP | 007 | 156
MERGED: To seed a Burst-compatible IJobEntity's per-frame random number generator, use `SystemAPI.Time.ElapsedTime` once per frame to initialize `Unity.Mathematics.Random`, passing the result as a job field for independent, frame-coherent operation; this avoids per-entity allocations and contention. A rolling average can be implemented with a fixed-size `Vector3[]`, a write-head index, and a running average field, achieving 
  ORIG1: Recipe: Burst-compatible per-frame RNG seeded by elapsed time (RCP-performance-007) :: How do we seed per-frame RNG in a Burst-compatible IJobEntity without per-entity allocations? | approach: seed Unity.Mathematics.Random from SystemAPI.Time.ElapsedTime once per frame, pass as job field; each job copy is independent so no contention, Burst-safe, frame-coherent | origin: lands-of-old-
  ORIG2: Recipe: Rolling average buffer allocation-free (RCP-monobehaviours-156) :: Fixed Vector3[] + write-head index + running average field. O(1) per tick: subtract old/N, add new/N, advance head. Zero allocation; correct from frame 0 (zero-initialized). | origin: Polarith AI | file: Recipes/monobehaviours/rolling-average-buffer-allocation-free.md | repo: C:\Fran\_Unity\unity-wo

### 103 [global] Two-Phase OBB-to-AABB and Spline Segment Matrix Precomputation for Vegetation Exclusion
id=87c64ab5b193ff7a folded=2 minCos=0.812
HARD(3): RCP | 018 | 019
MERGED: To precisely exclude vegetation along curved paths, pre-compute segment Oriented Bounding Box (OBB) matrices with padding once, deriving per-segment Axis-Aligned Bounding Boxes (AABB) from all 8 corners for broad-phase tile filtering and caching `Matrix4x4.Inverse` once per segment; this approach originated in `lands-of-old-runtime`, documented in files `Recipes/performance/two-phase-obb-aabb-curved-geometry-exclusio
  ORIG1: Recipe: Two-phase OBB-to-AABB vegetation exclusion for curved roads (RCP-performance-018) :: How do we exclude vegetation along a curved path (road, spline) precisely without over-excluding adjacent areas or paying repeated matrix inversion cost per tree? | approach: pre-compute segment OBB matrices with padding once, derive per-segment AABB from all 8 corners for broad-phase tile filtering
  ORIG2: Recipe: Spline segment matrix pre-computation for bounded vegetation removal (RCP-performance-019) :: How do we pre-compute per-segment TRS matrices for a spline to drive bounded vegetation or instance removal without redundant per-instance matrix math? | approach: divide spline [0,1] into N segments, compute one TRS matrix per segment (midpoint center, chord rotation, padded scale), store in reused

### 104 [global] AsyncGPUReadback Handling and Fallbacks
id=66302144dfb1bbd6 folded=3 minCos=0.863
HARD(3): RCP-gpu-001 | RCP | 001
MERGED: The AsyncGPUReadback.Request callback can execute synchronously on some GPU drivers, requiring the async-operation-started flag to be set *after* the Request call to prevent premature RT release; this is critical for thumbnail capture scenarios where the render target (RT) must remain alive until the GPU completes reading. For thumbnail generation using AsyncGPUReadback, release the RT within the callback's finally b
  ORIG1: Recipe: How do we handle transient AsyncGPUReadback failures with retry? (RCP-gpu-001) :: How do we handle transient AsyncGPUReadback failures with retry? | approach: store request as nullable, attempt GetData in try/catch/finally, always null in finally to enable retry, silently suppress exceptions | origin: lands-of-old-runtime | file: Recipes/gpu/async-gpu-readback-retry-try-catch.md 
  ORIG2: Recipe: AsyncGPUReadback with CPU fallback + deferred RT release (RCP-editor/how-do-you-use-asyncgpureadback-for-thumbnail) :: How do you use AsyncGPUReadback for thumbnail capture while keeping the RT alive until the GPU finishes? | approach: release RT inside callback's own finally (not outer scope); check hasError and fall back to synchronous ReadPixels; set asyncStarted flag AFTER Request call because callback can fire 
  ORIG3: AsyncGPUReadback callback can fire synchronously on some GPU backends :: AsyncGPUReadback.Request callback may execute immediately (synchronously) on certain GPU drivers, before Request returns. Set the async-operation-started flag AFTER the Request call, not before. This guards against callback firing before the flag is set, causing RT release before GPU finishes readin

### 105 [global] UIToolkit ScrollView Inertial Scrolling and Scrollbar Fixes
id=cf3716b430cad08e folded=2 minCos=0.831
HARD(3): RCP | 085 | 086
MERGED: Implement inertial scrolling on UIToolkit ScrollView using a scheduled repeating lerp that decays velocity until it falls below a threshold, then self-terminates via `schedule.Execute().Until()`; details in `Recipes/editor/uitoolkit-scrollview-inertial-scroll-schedule-lerp.md` within the `C: ran_unity ity-workflow-optimization` repository. Fix scrollbar stuck-visible bug after content size changes by setting `scrolle
  ORIG1: Recipe: UIToolkit ScrollView inertial scroll via schedule lerp (RCP-editor-085) :: Implement inertial scrolling on a UIToolkit ScrollView by scheduling a repeating lerp that decays velocity each tick until below threshold, then stops. Uses schedule.Execute().Until() to self-terminate. | approach: velocity decay lerp in scheduled item, Until() self-stop when velocity near zero | or
  ORIG2: Recipe: UIToolkit ScrollView stuck scrollbar fix via highValue hide (RCP-editor-086) :: Fix UIToolkit ScrollView scrollbar stuck-visible bug: after content size changes, set scroller.highValue = 0 then hide the scrollbar element when content fits — the built-in visibility logic can fail to auto-hide after dynamic content updates. | approach: force highValue=0 + explicit style.display=N

### 106 [global] AnimationCurve Force with Queue-Based Teleportation Recipe
id=5ca8590cf6b2ca3f folded=2 minCos=0.881
HARD(3): RCP | 020 | 161
soft(1): AnimationCurve-driven
MERGED: To prevent NullReferenceExceptions and force spikes, cache the Rigidbody in Awake, reset elapsed time in OnEnable, and guard FixedUpdate with a null check while evaluating an AnimationCurve based on elapsed time; documented in `Recipes/physics/animationcurve-force-forcemode-enable-guard.md` within `C:\Fran_Unity\unity-workflow-optimization`. For queue-based teleportation, use a `Queue<Rigidbody>` and dequeue in Fixed
  ORIG1: Recipe: AnimationCurve-driven force with ForceMode guard on enable (RCP-physics-020) :: Cache Rigidbody in Awake, reset elapsed time in OnEnable, guard FixedUpdate with null check, evaluate AnimationCurve with elapsed time. Prevents NullRef and force spikes when component enables before Rigidbody is ready. | approach: Awake cache + OnEnable reset + null guard | origin: MagicPig Shared 
  ORIG2: Recipe: Queue-based teleporter with velocity reset (RCP-monobehaviours-161) :: Queue<Rigidbody> + FixedUpdate dequeue: SetActive(false), set position/rotation, zero velocity+angularVelocity, SetActive(true). Disable destination for one WaitForFixedUpdate to suppress re-trigger. | origin: Polarith AI | file: Recipes/monobehaviours/queue-teleporter-velocity-reset.md | repo: C:\F

### 107 [global] Auto-Sync Scripting Defines & File Change Events with Integration Tests
id=3e01ec78f414a9e8 folded=3 minCos=0.79
HARD(3): RCP | FastScriptReload | FSW
MERGED: To auto-sync scripting defines from installed optional modules, use `[DidReloadScripts]` combined with `File.Exists` checks for robustness before AssetDatabase is ready (Recipes/editor/how-do-i-auto-sync-scripting-defines-when.md; repo: C: ran_unity ity-workflow-optimization). File system watcher callbacks should queue events into a `ConcurrentQueue<string>` and drain on the main thread via `EditorApplication.update`
  ORIG1: Recipe: defines sync via sentinel files (RCP-editor/how-do-i-auto-sync-scripting-defines-when) :: Auto-sync scripting defines from installed optional modules using [DidReloadScripts] + File.Exists sentinel checks — more robust than assembly scanning because it works before AssetDatabase is ready. | origin: AHAKuo Creations — Signalia | file: Recipes/editor/how-do-i-auto-sync-scripting-defines-wh
  ORIG2: Recipe: Dispatch file change events in order without blocking the watcher thread (RCP-editor/how-do-we-dispatch-file-change-events-in-order) :: Queue events from the FSW callback into a ConcurrentQueue<string>, then drain in EditorApplication.update on the main thread. The FSW callback must complete fast — never call AssetDatabase or compile from inside it. Origin: FastScriptReload. | file: Recipes/editor/how-do-we-dispatch-file-change-even
  ORIG3: Recipe: Write integration tests that verify method behavior before and after code change (RCP-editor/how-do-we-write-integration-tests-that-verify-a) :: Embed 'after' code as commented lines prefixed with sentinel string (e.g. //<test-change>//). Test harness strips sentinel prefix to activate lines, compiles/runs, restores original in finally. Co-locates before/after states in one fixture file. Origin: FastScriptReload. | file: Recipes/editor/how-d

### 108 [global] Weighted Random Selection and Wave Composition
id=dbd86760fb1e7e42 folded=3 minCos=0.75
HARD(3): RCP | 013 | 104
MERGED: Implement weighted random selection with a finite budget by filtering a `NativeList` based on cost+difficulty, then using weighted-random picking and deducting costs; pruning ineligible items guarantees termination (origin: `lands-of-old-runtime`, file: `Recipes/dots-ecs/weighted-random-budget-depletion.md`, repo: `C:‫ran_Unityity-workflow-optimization`). Achieve unbiased random list exclusion without allocation usin
  ORIG1: Recipe: Weighted random selection with incremental budget depletion (RCP-dots-ecs-013) :: How do we perform weighted random selection while consuming a finite budget, ensuring variety and guaranteed termination? | approach: build eligible NativeList filtered by cost+difficulty, weighted-random pick, deduct cost, prune ineligible items incrementally — monotone shrink guarantees terminatio
  ORIG2: Recipe: Wave composition — guaranteed-first + weighted fill on shared budget (RCP-monobehaviours-104) :: Two-phase wave composition: Phase 1 adds all guaranteed enemy types (deducting budget); Phase 2 weighted-random fills remaining budget with attempt cap to prevent infinite loop. | origin: IntoTheEndlessSea | file: Recipes/monobehaviours/wave-composition-guaranteed-first-weighted-fill.md
  ORIG3: Recipe: Unbiased random list exclusion via index remapping — no allocation (performance) :: Pick Random.Range(0, Count-1), then increment if result >= skip index. Uniform distribution, zero allocation, no filtered copy. IndexOf is O(n); pass skip index directly if already known. | origin: io.continis.scriptable-object-tools

### 109 [C--Fran-LLM-Workflow-Optimization] Project Document Discovery & Atomic Note Extraction
id=ec20d21eb7754c9e folded=3 minCos=0.789
HARD(3): indexer.ts | SELECT | SQL
MERGED: Documents are discovered using `discoverProjectDocs`, which globs **/*.md from distinct `sessions.cwd` values; the atom_type is derived from filename: 'architecture' or 'design' results in architecture, 'readme', 'index', or 'claude' results in reference, and all other filenames default to project_note. Discovery ignores node_modules, dist, .git, .next, and __pycache__ directories. `repo-analysis` extracts 15–30 dura
  ORIG1: discoverProjectDocs uses SELECT DISTINCT cwd :: Project doc discovery (indexer.ts) queries sessions for distinct cwd values, globs **/*.md from each, and derives atom_type from filename. SELECT DISTINCT at SQL level prevents duplicate work in batch contexts.
  ORIG2: Project doc discovery: atom_type from filename keywords :: discoverProjectDocs globs **/*.md from sessions.cwd. Atom_type derived: 'architecture'/'design'/'adr' in name → architecture; 'readme'/'index'/'claude' → reference; default → project_note. Ignore: node_modules, dist, .git, .next, __pycache__, etc.
  ORIG3: Atomic Note Extraction & Structure :: repo-analysis extracts 15–30 durable concept definitions per run into a shared atom dictionary with YAML frontmatter; atoms are deduplicated and cross-referenced to create a searchable knowledge base, accessible via `epub-zk atomics <file.md...>` or a web UI panel. Atomic extraction occurs post-hoc 

### 110 [global] Recursive Hierarchy Traversal for GameObject Operations
id=8d8002110f4074bc folded=2 minCos=0.874
HARD(3): GetAllRootGameObjects | RCP | SetLayerRecursive
MERGED: To retrieve all root GameObjects across loaded scenes, iterate `SceneManager.sceneCount`, guard `scene.isLoaded`, and accumulate results from `GetRootGameObjects()` as described in `Recipes/monobehaviours/how-do-you-retrieve-all-root-gameobjects-across.md` (origin: Gaskellgames/GgCore). For recursively setting a GameObject's layer, implement a stack-based Depth-First Search (DFS) traversal to avoid recursion depth is
  ORIG1: Recipe: GetAllRootGameObjects across all loaded scenes (RCP-monobehaviours) :: How to retrieve all root GameObjects across all currently loaded scenes in a single call | approach: iterate SceneManager.sceneCount, guard scene.isLoaded, accumulate GetRootGameObjects() | origin: Gaskellgames/GgCore | file: Recipes/monobehaviours/how-do-you-retrieve-all-root-gameobjects-across.md
  ORIG2: Recipe: SetLayerRecursive stack-based hierarchy traversal (RCP-monobehaviours) :: How to set a GameObject's layer recursively across all children without foreach+Destroy hazards | approach: stack-based DFS traversal to avoid recursion depth issues | origin: Gaskellgames/GgCore | file: Recipes/monobehaviours/how-do-you-set-a-gameobjects-layer-recursively.md

### 111 [C--Fran-LLM-Workflow-Optimization] Tooling Reference Migration & Deduplication
id=c8ba8ca063b1b8fb folded=2 minCos=0.901
HARD(3): ClaudeNexus | MCP | 350
MERGED: The tooling reference is migrating from C:\Fran\LLM_Workflow_Optimization\Documents\master-tooling-reference.md to a database system using .db files and an auto-generated INDEX.md, managed via `add_proposal.py`, comprising 312 rows (298 from 17 domain tables plus 14 in Deferred & Rejected Items). The historical `master-tooling-reference.md` tracks adoption of Docling, Milvus/pymilvus, mxbai-embed-large, BM25+RRF, Cla
  ORIG1: Tooling Reference Migration & Registry Details :: The tooling reference is migrating from C:\Fran\LLM_Workflow_Optimization\Documents\master-tooling-reference.md to a database system using a .db file and an auto-generated INDEX.md, managed via `add_proposal.py`; the actual tooling reference comprises 312 rows (298 from 17 domain tables plus 14 in D
  ORIG2: Multi-Domain Tool Deduplication Failure & Design :: The approved design's multi-domain deduplication case involving `claude-context` and Milvus fails because titles are not exact matches, and the 'near-exact' criteria is undefined; do not use this as precedent for cross-link deduplication logic. Tools spanning multiple domains like `claude-context` a

### 112 [C--Fran-Voodoo-Magic] Flat-Codebase & Prefab Patterns
id=63930ddcd12aea7e folded=2 minCos=0.832
HARD(3): PlayButtonView | GrimoireView | BuildCarrier
MERGED: The codebase uses a flat-component design; components like `CameraLookAround` encapsulate state, preventing sibling component access and favoring functionality folding within the owning component to minimize coupling. Prefabs are the single source of truth for component state (sprites, flags), eliminating dead code via downstream injection removal; deduplication skips nested prefab components using `PrefabUtility.Get
  ORIG1: Flat-codebase pattern: component state remains private :: This codebase follows a flat-component design where each component (e.g., CameraLookAround) owns and encapsulates its internal state. Avoid sibling components reading public state getters; instead fold related functionality into the owning component. This keeps coupling low and state management loca
  ORIG2: Prefab Authority, Component Deduplication & Lazy Discovery Patterns :: Prefab serves as single source of truth for component state (sprites, flags). Downstream injections duplicating prefab assignments are removed to eliminate dead code. Deduplication skips nested prefab components via `PrefabUtility.GetCorrespondingObjectFromSource(component) != null`, surfacing issue

### 113 [C--Fran-LLM-Workflow-Optimization] Plugin Path Management and Resolution
id=effb45d8ca213c50 folded=2 minCos=0.774
HARD(3): C:\Program Files\Git | PreToolUse | PostToolUse
MERGED: Use `${PLUGINS}` for portable plugin file paths, replacing `C:/Users/Fran/.claude/plugins/...`. If `$PLUGINS` is unset or misconfigured, set `env.PLUGINS` to the installed cache path (e.g., `~/.claude/plugins/cache/local/`). This prevents PATH resolution issues and ensures hooks execute from the installed plugin cache (e.g., `~/.claube/plugins/cache/local/flow-shared/`). Local development occurs in `C:\Fran\LLM_Workf
  ORIG1: Use ${PLUGINS} template variable for portable paths :: Replace hardcoded plugin paths (e.g., `C:/Users/Fran/.claude/plugins/...`) with the `${PLUGINS}/...` template variable when organizing or moving plugin files. This makes paths portable and maintainable across different environments.
  ORIG2: Plugin Path Resolution and Development Workflow :: When `$PLUGINS` is unset or misconfigured, Windows PATH resolution falls back to unintended paths like `C:\Program Files\Git`, breaking PreToolUse hooks; explicitly set `env.PLUGINS` to the installed cache path (e.g., `~/.claude/plugins/cache/local/`). Hooks and scripts execute from the installed pl

### 114 [C--Fran-IntoTheEndlessSea] ECS Aggregate Preview Utility & Stat Resolution Centralization
id=2381141a93c3cae6 folded=2 minCos=0.85
HARD(3): MonoBehaviours | EditMode | DOTS
MERGED: To display ECS-computed aggregates in the UI, create static utility functions replicating ECS aggregation logic, avoiding ECS code or temporary entities within the UI layer; see `[1]`. Stat resolution logic previously duplicated across files like `ShipEntityBuilder` and `LoadoutStatPreview/ResolveModuleStats` must be centralized into a shared static utility class, such as `ShipStatAggregator`. The `LoadoutStatPreview
  ORIG1: Static utility mirrors ECS logic for UI preview :: When UI needs to display previews of ECS-computed aggregates (like ship stats), create a pure static utility function that replicates the ECS aggregation logic. This avoids pulling ECS code into the UI layer or spawning temporary entities for preview-only reads.
  ORIG2: Centralize Stat Resolution Logic & Decouple LoadoutStatPreview :: Duplicated stat resolution logic in files like `ShipEntityBuilder` and `LoadoutStatPreview/ResolveModuleStats` causes divergence; merge reviews should block this, requiring shared static utility classes for both callers. Shared game logic between MonoBehaviours and ECS/DOTS systems should be central

### 115 [C--Voodoo-Paper2-clean-diagnostics] Zone Creation and Logging Considerations
id=d6ebaf5a43f6338d folded=2 minCos=0.849
HARD(3): mergeSourcePoints | CheckPlayersToKillInArea | GenericZone
MERGED: Zone logging of (zoneCreatedPointsCount, radius, duration) via ZoneCreationData precedes closure verification; however, these logs don't guarantee zone creation success due to degenerate geometry. `PopulateMeshAnimated` is deferred by the `ZoneMeshBuildScheduler` throttled to `MaxBuildsPerFrame=2`; trace delays using enqueue→scheduler→completion anchors should be used for investigation. The 'pick bigger per-side cand
  ORIG1: Zone logging precedes closure verification :: ZoneCreationData logs (zoneCreatedPointsCount, radius, duration) emit before later real-gain re-checks; passing intermediate logs don't guarantee zone creation succeeds, as degenerate geometry can fail silently after logging.
  ORIG2: Zone Creation and Animated Fill Performance Bottlenecks & Data Discrepancies :: Zone shadows render immediately; animated fills (`PopulateMeshAnimated`) are deferred via the ZoneMeshBuildScheduler throttled to `MaxBuildsPerFrame=2`, suggesting scheduler contention or distance-based culling. Trace delays using enqueue→scheduler→completion anchors. The 'pick bigger per-side candi

### 116 [global] ECS Entity Creation and Management
id=d7eea50f8ef737d6 folded=2 minCos=0.872
HARD(3): RCP | 008 | MonoBehaviour
soft(1): MonoBehaviour.OnDestroy
MERGED: Prior to ECB playback, use `EntityManager.CreateEntity()` for stable entity references; subsequently add components/buffers via the ECB. `EntityQuery` lacks an `IsCreated` property, requiring external access control. Cache `EntityQueries` in `Start`/`OnEnable` or a `[BurstCompile] ISystem.OnCreate` using `EntityQueryBuilder(Allocator.Temp).Build(ref state)` to avoid per-frame creation. Verify `World.IsCreated` before
  ORIG1: Recipe: How do we create an ECS entity and store its reference in managed code before ECB playback? (RCP-dots-ecs-008) :: How do we create an ECS entity and store its reference in managed code before ECB playback? | approach: Create via EntityManager.CreateEntity() directly (not ECB) so the reference is stable immediately; add all components/buffers via ECB afterward | origin: lands-of-old-runtime | file: Recipes/dots-
  ORIG2: EntityQuery lifecycle: creation, caching, and safe disposal in Unity ECS :: EntityQuery lacks IsCreated; guard access with an external bool flag. Cache in Start/OnEnable or [BurstCompile] ISystem.OnCreate via EntityQueryBuilder(Allocator.Temp).Build(ref state), never per-frame. Always check World.IsCreated before Dispose in OnDestroy—the ECS World tears down before MonoBeha

### 117 [C--Fran-uber-db] sqlite-vec Row ID and Schema Considerations
id=28cc969f41d30969 folded=2 minCos=0.904
HARD(3): DDR-006 | DDR | 006
MERGED: The `sqlite-vec` virtual table rowid requires BigInt parameters from Node.js queries in src/indexer.ts delete-cascade logic due to conflicts with SQLite's rowid when using `vec_id`. The architecture uses a single SQLite database with `content_type` discrimination across typed tables like `chunks` and `chunks_vec`, enforcing chunking at the lowest common denominator. `chunks_vec.vec_id` must be declared as INTEGER PRI
  ORIG1: SQLite Database Architecture and `chunks_vec` Schema :: The architecture uses a single SQLite database with `content_type` discrimination across typed tables like `chunks` and `chunks_vec`, enforcing chunking at a lowest-common-denominator. `chunks_vec.vec_id` must be declared as INTEGER PRIMARY KEY AUTOINCREMENT for Q6 row-ID stability; DDR-006 incorrec
  ORIG2: sqlite-vec rowid requires BigInt from node :: sqlite-vec virtual table rowid parameters must be BigInt (not plain JS number) from node.js queries. Established pattern in this codebase; also used in src/indexer.ts delete-cascade logic.

### 118 [global] Claude Code MCP Health Checks, Classifier Outages, and Subagent Behavior
id=ce2474e8873ace28 folded=2 minCos=0.914
HARD(3): System.IO.File.WriteAllText | ScheduleWakeup | WriteAllText
MERGED: MCP server health checks have a ~1-2s timeout causing `-32001 Request timed out` errors with npx servers despite successful manual JSON-RPC testing; resolve slow `npx package@latest`-based cold starts by pinning versions in `~/.claude.json` (e.g., `firebase-tools@1.2.3`). The `mcp__plugin_claude-context_claude-context__search_unity_knowledge` classifier, using Opus, experiences transient outages/timeouts resolving wi
  ORIG1: Claude Safety Classifier Outages and Subagent Limitations :: Outages of claude-opus-4-8 or claude-sonnet-4-6 safety classifiers cause Agent, PowerShell, and mcp__plugin_claude-nexus operations to fail with a 'safety cannot be determined' error, while Read/Grep/Glob tools remain unaffected; during outages, switch permission mode from auto to acceptEdits via /p
  ORIG2: MCP Health Checks, npx Cold Starts, and Classifier Outages :: Claude Code's MCP server health-check timeout is too short (~1-2s) for npx-based servers, causing `-32001 Request timed out` errors despite successful manual JSON-RPC testing. Launching MCP servers via `npx package@latest` results in slow cold-starts due to npx re-resolving the package each launch; 

### 119 [C--Fran-LLM-Workflow-Optimization] Cross-Index Generation and Index Management
id=7a03a5789bdf0e65 folded=2 minCos=0.878
HARD(3): add_<type>.py | design.md | references.md
MERGED: The `build_cross_index.py` script updates CROSS-INDEX.json and CROSS-INDEX.md without modifying topic `.md` files; outdated `flow_version` fields in topic files are artifacts of previous `write_topic_files.py` runs. Project documentation originates from `.md` files, with derived indexes (`records.db`, `architecture.md`, `notes.md`) generated by `rebuild_index.py`; conflicts require editing original `.md` files then r
  ORIG1: build_cross_index.py modifies only the cross-index, not individual topics :: The `build_cross_index.py` script exclusively updates CROSS-INDEX.json and CROSS-INDEX.md files; it does not modify individual topic files directly, adhering to a read-only policy for those files. Outdated flow_version fields in topic files are artifacts of previous runs of write_topic_files.py, not
  ORIG2: Decision Index Management & Conflict Resolution :: Project documentation is sourced from individual `.md` files, with derived indexes (`records.db`, `architecture.md`, `notes.md`) generated by `rebuild_index.py`. Conflicts during merges should be resolved by manually editing the original `.md` files and then regenerating derived files using scripts 

### 120 [C--Fran--Games-Monster-Hotel] Monster Hotel Core Loop Architecture and Request Handling
id=09b3e80e96315dc6 folded=2 minCos=0.792
HARD(3): AddWorker | MonsterBlueprint | MonsterType
soft(5): DayCycle.AddWorker(Worker w | DayCycle.AddWorker | MonsterBlueprint.RequestCooldownSeconds | MonsterType.requestCooldownSeconds | GameSettingsSO.minRequestCooldownSeconds
MERGED: The Monster Hotel core loop architecture was approved and updated on 2026-05-06, encompassing phases T0–T9 with deliverables including Asmdefs, fakes, request patience, worker fulfillment, a full day cycle, persistence seam, Unity shell, and PlayMode smoke tests. `Domain.asmdef` must have zero UnityEngine references for architectural compliance. The maximum number of worker slots is determined by `DayCycle.MaxWorkerS
  ORIG1: architecture_monster_hotel_core_loop_architecture: Exit criteria :: All EditMode tests green (~70+). All 3 PlayMode smoke tests green. `Domain.asmdef` has zero UnityEngine reference. Manual: tap room with pending request → TapActionPanel appears; tap room without → upgrade panel appears; checkout monster → currency HUD increments.
  ORIG2: Monster Hotel Core Loop Architecture & Request Handling :: The Monster Hotel core loop architecture was approved and updated through Phase 3 on 2026-05-06, encompassing phases T0–T9 with deliverables including Asmdefs, fakes, request patience, worker fulfillment, a full day cycle, persistence seam, Unity shell, and PlayMode smoke tests. `DayCycle.MaxWorkerS

### 121 [global] WSL2 Docker VHDX Management and Configuration
id=d2852451cdfa2322 folded=2 minCos=0.891
HARD(3): 2.7 | CLI | UAC
MERGED: Docker Desktop's WSL2 virtual hard disk (vhdx) file, such as `docker_data.vhdx`, grows with data writes but doesn’t automatically shrink; `docker system prune` and `docker system prune -a --volumes` only free logical space. To reclaim physical disk space, compact the vhdx using PowerShell's `Optimize-VDisk -Path <vhdx-path> -Mode Full` or Diskpart’s `compact vdisk` command, requiring first shutting down WSL with `wsl
  ORIG1: WSL2 VmmemWSL Memory Management and Configuration :: VmmemWSL hosts Docker Desktop's engine; container memory usage affects its footprint. Stopping containers or reducing Docker memory decreases this consumption. `wsl --shutdown` terminates the WSL2 utility VM, releasing VmmemWSL memory to Windows and restarting the distro. A `.wslconfig` file (e.g., 
  ORIG2: WSL2 Docker VHDX Auto-Shrink and Compaction :: Docker Desktop's WSL2 virtual hard disk (vhdx) file, such as `docker_data.vhdx`, grows with data writes but doesn’t automatically shrink even after deleting containers or volumes; `docker system prune` and `docker system prune -a --volumes` only free logical space. To reclaim physical disk space, co

### 122 [C--Fran-LLM-Workflow-Optimization] Pymupdf4llm PDF Chapter Detection and Extraction
id=d1cb36f7b7ab5d9b folded=2 minCos=0.765
HARD(3): \n\n | ^\d+\ | ^ £+§
MERGED: Pymupdf4llm's markdown extraction uses one-section-per-page for scanned/OCR PDFs lacking H1 headings, preventing large file sizes and enabling granular processing via a three-tier detection algorithm. PyMuPDF’s `doc.get_toc()` extracts bookmarks/outline data into the pipeline’s `nav_entries` format for Tier 1 chapter detection. Chapter detection employs a four-tier strategy: EPUB TOC, PDF outline/bookmarks, H1/H2/H3 
  ORIG1: PDF fitz fallback: use blocks not text :: When pymupdf4llm crashes with ONNX errors, the fallback uses `fitz.get_text('blocks')` not `get_text('text')`. The text mode collapses all content into one paragraph, breaking section and heading detection. Blocks mode separates visual blocks with `\n\n`, preserving paragraph structure and allowing 
  ORIG2: PDF Chapter Detection and Extraction Strategy :: Pymupdf4llm's PDF markdown extraction uses one-section-per-page for scanned/OCR PDFs lacking H1 headings, preventing large file sizes and enabling granular processing by the three-tier detection algorithm. PyMuPDF's `doc.get_toc()` extracts PDF bookmarks/outline data into the pipeline’s `nav_entries

### 123 [global] Delayed Fade State Machine, Toast Notifications, and Editor Color Animation
id=57be4fe735085a50 folded=3 minCos=0.749
HARD(3): CanvasGroup | MagicPig | GUI
MERGED: A serializable `FadeHelper` class utilizes a 5-state enum machine (Unset/FadingIn/Visible/FadingOut/Hidden) with per-direction delay+duration floats and re-entry guards; it optionally animates via an `animate` bool. This originates from `Recipes/ui-ux/delayed-fade-state-machine-dual-animation.md` in repository `C: ran_Unity ity-workflow-optimization`. Toast notifications use a single timer accumulating phase threshol
  ORIG1: Recipe: Delayed fade state machine with dual animation support (RCP-ui-ux-017) :: How do we implement a reusable CanvasGroup fade helper with per-direction delays, durations, and guard against overlapping fade calls? | approach: serializable FadeHelper class with 5-state enum machine (Unset/FadingIn/Visible/FadingOut/Hidden), per-direction delay+duration floats, re-entry guards, 
  ORIG2: Recipe: Timed fade state machine for toast notifications (RCP-ui-ux-018) :: How do we implement a timed fade state machine for toast notifications (fade in → hold → fade out) without separate timers, coroutines, or off-by-one phase errors? | approach: accumulate a single timer and evaluate cumulative phase thresholds (fadeIn, fadeIn+hold, fadeIn+hold+fadeOut) with early ret
  ORIG3: Recipe: EditorApplication.timeSinceStartup for Edit-mode GUI color animation (RCP-editor-105) :: Time.time is frozen at 0 in Edit mode. Use EditorApplication.timeSinceStartup (advances in real seconds) + Mathf.PingPong for oscillation + Color.Lerp for flashing inspector colors. Subscribe EditorApplication.update += Repaint to drive repaints; unsubscribe in OnDisable. | approach: timeSinceStartu

### 124 [C--Voodoo-Paper2-clean-diagnostics] Clipper Optimization & Loop Closure Validation Workflow
id=0af382941fe9c057 folded=2 minCos=0.9
HARD(3): StartIndex/EndIndex | StartIndex | EndIndex
MERGED: Clipper optimizations use a prototype → validate → port pattern, validated against 24 oracle game replays (fixtures), to prevent regressions. `Clipper` merge operation fixes extend test suites like `ClipperBackendDivergenceTest`, ensuring baseline fixture pass/fail status; refactors leverage existing comprehensive test coverage and reject extensions to `FixtureLoader`. Standalone .NET console applications, such as `T
  ORIG1: Loop Closure Validation Process & Standalone Test Risks :: Extracting test logic to standalone .NET console applications (e.g., `Tools/LoopClosureValidator`) improves CI run speed but introduces a drift-risk tradeoff, requiring synchronization between production source files (e.g., `GenericZone.cs MergeInflate`) and test mirrors (`MergeGain` function), doub
  ORIG2: Clipper Optimization & Validation Workflow :: Prior to porting Clipper optimizations or alternative designs to production, prototype them in a standalone validator and validate against a fixture set of 24 real game replays; this pattern—prototype → validate → port—prevents regressions on hard-to-reproduce cases. Fixes for `Clipper` merge operat

### 125 [C--Fran-LLM-Workflow-Optimization] Atom Management and Database Synchronization
id=e86ce40a6ba26ae1 folded=2 minCos=0.781
HARD(3): PRAGMA | DBSCAN | 001
soft(1): table_info
MERGED: Atoms are upserted by name using `add_atom.py`, deduplicating on the 'name' field, differing from `add_adr.py` which keys on ID; new atoms receive an ATOM-NNN ID and file, while existing ones merge sources and rewrite files, supporting batch JSON array input. Database consistency is maintained by unconditionally writing to the database then conditionally writing markdown files based on their existence. Syncthing conf
  ORIG1: Atoms upsert by name, not id (vs ADRs by id) :: add_atom.py upserts atoms by unique name field as dedup key—unlike add_adr.py which keys on id. New atoms receive ATOM-NNN id and file created; existing atoms merge sources and rewrite file. Batch JSON array supported.
  ORIG2: Atoms Database and Markdown File Synchronization Strategy :: Ensure database consistency: always write to the database unconditionally first, then gate file writes based on file existence; missing markdown files should not block database persistence. Syncthing conflicts can revert gitignored `.db` files (atoms.db, records.db, sources.db, proposals.db, .stvers

### 126 [C--Voodoo-Paper2-clean-diagnostics] Clipper2 Performance and Stability Considerations
id=c8ed2e556f0b6676 folded=2 minCos=0.769
HARD(3): applying this after | or before final union; parameter order differs from | overloads crash due to indexing errors in
soft(1): Clipper2CSharpLib.Solve64
MERGED: The `Clipper2.ClipAllNonAlloc` polygon clipping operation has a performance cost, gated by `player.ID == 1` to prevent bot overhead. Clipper2Lib is a .NET library independent of Unity, requiring `MathUtils.GetPolygonSurface` dependency checks and utilizing a thin adapter for `UnityEngine.Vector2/Mathf`. To reliably merge tangent shapes, inflate one operand by 0.01–0.05 units using `PaperClipper.InflatePathNonAlloc(pa
  ORIG1: Clipper2.ClipAllNonAlloc carries perf cost :: Clipper2.ClipAllNonAlloc polygon clipping operation is computationally expensive; gate diagnostic usage to player.ID == 1 to avoid unnecessary bot overhead and improve non-debug code path performance.
  ORIG2: Clipper2 Memory Consolidation :: Clipper2Lib is .NET (System/* only), Unity-independent, utilizing a thin adapter for UnityEngine.Vector2/Mathf; this enables standalone validation and requires MathUtils.GetPolygonSurface dependency check in tests. To reliably merge tangent shapes, inflate one operand by 0.01–0.05 units before union

### 127 [C--Fran-RumbleEditorTools] Editor Selection History and Suppression of Ping During Selection
id=90b1a2782ce01784 folded=2 minCos=0.838
HARD(2): RCP | SelectWithoutFraming
soft(2): Recipes/editor/how-do-you-implement-an-editor-selection-history.md | Recipes/editor/how-do-you-call-selectionobjects-programmatically.md
MERGED: To prevent spurious history entries in the selection history, within the `Selection.selectionChanged` handler, check `Event.current` for Ctrl/Cmd+Z and Ctrl+Y / Cmd+Shift+Z, returning early if found; also respect a `_skipNext` flag for programmatic navigation, storing state in `ScriptableSingleton`. Before assigning to `Selection.objects`, set `m_RectSelectInProgress` on all `SceneHierarchyWindow` instances and `m_In
  ORIG1: Recipe: Selection history with undo/redo keystroke guard (RCP-editor/how-do-you-implement-an-editor-selection-history) :: In Selection.selectionChanged handler, check Event.current for Ctrl/Cmd+Z and Ctrl+Y / Cmd+Shift+Z and return early to avoid pushing spurious history entries. Also check a _skipNext flag for programmatic navigation. Store state in ScriptableSingleton. | origin: vInspector | file: Recipes/editor/how-
  ORIG2: Recipe: SelectWithoutFraming suppresses hierarchy/project ping via reflection (RCP-editor/how-do-you-call-selectionobjects-programmatically) :: Before Selection.objects assignment, set m_RectSelectInProgress on all SceneHierarchyWindow instances and m_InternalSelectionChange on all ProjectBrowser instances to true. Reset both via EditorApplication.delayCall (not synchronously) — windows process the change asynchronously. | origin: vInspecto

### 128 [global] Git Branch Tracking Quirks and Upstream Configuration
id=0639b2e349bd85bb folded=2 minCos=0.817
HARD(2): panam/bugfix/5630 | 5630
soft(1): git checkout -b panam/bugfix/5630 panam/main
MERGED: Creating a new Git branch using `git checkout -b newname sourcebranch` inherits the upstream tracking of `sourcebranch`; if `newname` differs from `sourcebranch`, the `.merge` in the branch configuration will incorrectly point to `sourcebranch`. This leads to `git push` targeting the wrong remote branch. To detect this, use `git config --get-regexp '^branch\.<name>\.'` and compare the `.remote` and `.merge` values; i
  ORIG1: Local branch without upstream tracking blocks PR creation :: A local branch never pushed to origin has no upstream tracking, preventing PR/publish actions via UI. Establish tracking with `git push -u origin <branch>`.
  ORIG2: Branch tracking inheritance causes wrong push target :: Creating branch via `git checkout -b newname sourcebranch` inherits sourcebranch's upstream tracking. If names differ (e.g., `git checkout -b panam/bugfix/5630 panam/main`), git sets branch's `.merge` to sourcebranch's name, not newname. Result: `git push` targets source, not the new branch. Detect:

### 129 [C--Fran-LLM-Workflow-Optimization] Ollama Windows Autostart and Reboot Healing
id=15cd95144f8545f2 folded=3 minCos=0.797
HARD(2): CurrentVersion | DMR
soft(1): HKCU\...\[Run]\Ollama
MERGED: {"autostart": {"registry_key": "HKCU\...\Run\Ollama", "executable": "C:\Users\Fran\AppData\Local\Programs\Ollama\ollama app.exe"}, "reboot_healing": {"script_purpose": "starts Ollama, waits for Docker readiness using `docker info`, checks compose stacks for network drift, and force-recreates drifting stacks", "dependency_embedding": "Ollama is started first due to provider dependency", "docker_readiness_check": "`doc
  ORIG1: Multi-service MCP bootstrap launcher pattern :: For MCP servers with external dependencies (Ollama, Docker services), write a launcher that probes dependencies on known ports, auto-starts if down (Ollama :11434, Docker daemon), runs docker compose up -d, waits for health checks, then execs the server. Store in plugin folder; call from .mcp.json c
  ORIG2: Ollama missing Windows autostart (Run-key entry) :: Ollama does not auto-initialize on logon because no Windows Run-key registry entry exists for it. Currently it only starts when the claude-context MCP explicitly launches it. Adding a Run-key entry (HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Ollama) is the proper fix for auto-init, independe
  ORIG3: Ollama Autostart & Reboot Healing on Windows :: Ollama autostarts at logon via the Windows Run-key registry entry `HKCU\...\[Run]\Ollama` pointing to `C:\Users\Fran\AppData\Local\Programs\Ollama\ollama app.exe`, which starts the server with a tray application, eliminating the need for startup wrappers or tool-specific initialization. To ensure is

### 130 [C--Fran-RumbleEditorTools] SerializedProperty Clipboard with Play Mode Preservation
id=a691ac7db89e555d folded=2 minCos=0.891
HARD(2): RCP | EnteredEditMode
soft(2): Recipes/editor/how-do-you-get-and-set-a-serializedproperty-value.md | Recipes/editor/how-do-you-preserve-monobehaviour-field-values.md
MERGED: To enable generic component clipboard functionality, use `SerializedProperty.GetBoxedValue()` / `SetBoxedValue()` (Unity 2022.1+) for copying and pasting arbitrary property values as boxed objects, avoiding per-type switch statements; on Save, iterate the `SerializedObject` storing a mapping of `propertyPath` to `boxedValue` within a `ComponentData` alongside a `GlobalID` in a `ScriptableSingleton`. Upon entering Edi
  ORIG1: Recipe: GetBoxedValue/SetBoxedValue for SerializedProperty clipboard (RCP-editor/how-do-you-get-and-set-a-serializedproperty-value) :: Use SerializedProperty.GetBoxedValue() / SetBoxedValue() (Unity 2022.1+) to copy/paste arbitrary property values as boxed objects without per-type switch statements. Enables generic component clipboard. | origin: vInspector | file: Recipes/editor/how-do-you-get-and-set-a-serializedproperty-value.md
  ORIG2: Recipe: Play-mode field preservation via ScriptableSingleton clipboard (RCP-editor/how-do-you-preserve-monobehaviour-field-values) :: On Save, iterate SerializedObject storing propertyPath->boxedValue in a ComponentData + GlobalID in a ScriptableSingleton. On EnteredEditMode, re-resolve by instanceID/GlobalID and call ApplyModifiedPropertiesWithoutUndo. Failed resolves go to retry list drained at next inspection. | origin: vInspec

### 131 [C--Fran-Automatic-Encyclopedias] Encyclopedia Analysis Workflow & Soft Gaps
id=9c7923d3e6bbb7e2 folded=2 minCos=0.878
HARD(2): missing_expected: [enc_names | enc_names
soft(1): missing_expected
MERGED: Successful encyclopedia routing with analyzer decline across all chapters (e.g., 'no relevant content') constitutes a soft gap, marking the encyclopedia pending and the book partial; no action is required unless the routing decision needs revisiting. The `route` phase of the encyclopedia pipeline always executes fully; analysis (`fork_analyze.py`) uses skip-existing logic during resume runs, blocking newly-routed enc
  ORIG1: Analyzer declining all content is legitimate soft gap :: When an encyclopedia is routed but the analyzer declines extraction across all chapters (e.g., 'no relevant content'), this is a legitimate soft gap, not an error. The encyclopedia stays pending, and the book is marked partial. No action required unless the routing decision should be revisited.
  ORIG2: Encyclopedia Analysis Workflow :: The encyclopedia pipeline separates routing (cheap, cached, idempotent) from analysis (expensive). The `route` phase always executes fully. `fork_analyze.py` uses skip-existing logic during resume runs; it blocks newly-routed encyclopedias if their directories or anchor files exist unless `--onboard

### 132 [C--Fran-Voodoo-Magic] Grimoire Rune System Cleanup & Asset Management
id=f21fb33242edfd6b folded=3 minCos=0.815
HARD(2): TextAssets | Populate
soft(1): AnimatedBurn_Material
MERGED: Removing runes involves deleting `RuneBurnLoop.cs`, the `BookRunes/assets` folder, the `UIRuneBurn` shader and its entry in `VoodooMagic_ShaderVariants.shadervariants`. Remove rune Image slots from `GrimoirePageContent` and rune fields from `GrimoireBookBuilder`. `RuneBurnLoop` toggles visibility on `GrimoirePageContent`, restarting animations and fading TextMeshPro (TMP) text via alpha channel to prevent conflicting
  ORIG1: Rune system cleanup dependencies :: When removing runes from Grimoire: delete RuneBurnLoop.cs, BookRunes/ assets, UIRuneBurn shader, and its entry in VoodooMagic_ShaderVariants.shadervariants (per project rule, keep that file clean). Also remove rune Image slots from GrimoirePageContent and rune fields from GrimoireBookBuilder.
  ORIG2: Loading UI & Grimoire Assets :: The loading view now displays a rune with a shader, replacing translated status text to avoid translation maintenance and provide visual feedback; this change eliminates the need for localized dynamic messages. Grimoire pages load via serialized TextAsset field references in the inspector, avoiding 
  ORIG3: RuneBurnLoop Integration & Asset Management :: Hide/Reveal functionality on `GrimoirePageContent` cooperates with the `RuneBurnLoop` ambient burn system by toggling rune visibility to restart their animation and fading TextMeshPro (TMP) text via alpha channel, avoiding conflicting burn materials on shared images. RuneBurnLoop components should b

### 133 [global] Claude Code Environment and Plugin Management
id=21971938c820a84b folded=2 minCos=0.853
HARD(2): PowerShell(python * | Read(path/**
soft(1): C:\Program Files\Git\bin\bash.exe
MERGED: On Windows, use PowerShell `Remove-Item -Path <path> -Force` for file deletion; harness-protected directories require manual deletion or build tool overwrites. Claude Code hard-detects Git Bash at `C:\inash.exe`, necessitating ! command overrides due to unavailable `bashPath` and `shellPath`. Plugin commands are defined in YAML frontmatter `.md` files within `plugin/commands/`, cached by the harness (potentially outd
  ORIG1: Claude Code Plugin Command Management and Security :: Claude Code hard-detects Git Bash at `C:\Program Files\Git\bin\bash.exe` on Windows; overrides are required for ! commands due to the lack of `bashPath` or `shellPath` configuration options. YAML frontmatter .md files in `plugin/commands/` define plugin commands, but the harness caches them, potenti
  ORIG2: PowerShell File Deletion in Claude Code Sandbox :: On Windows, use PowerShell `Remove-Item -Path <path> -Force` for file deletion instead of Bash `rm`, as Bash.exe wrappers are unreliable; always utilize native PowerShell cmdlets within harness commands to ensure reliability. PowerShell `Remove-Item` fails with 'This path is protected from removal' 

### 134 [global] Plugin Versioning, Settings Migration, and Editor Updates
id=1affc853c88cac22 folded=3 minCos=0.768
HARD(2): CodeStage/Maintainer | CodeStage
soft(1): Gaskellgames/GgCore
MERGED: Plugins requiring different DLL versions use version-gated subfolders (e.g., `RCP-editor/how-do-you-ship-a-plugin-that-needs-different`) containing precompiled DLLs; an `[InitializeOnLoad]` class activates the correct DLL via `PluginImporter.SetCompatibleWithEditor` and `EditorApplication.delayCall`, deleting legacy DLLs outside valid folders, originating from ConsolePro. Settings migration uses a ScriptableObject st
  ORIG1: Recipe: PluginImporter version-gated DLL activation (RCP-editor/how-do-you-ship-a-plugin-that-needs-different) :: Ship multiple precompiled DLLs in named version subfolders; an [InitializeOnLoad] class uses EditorApplication.delayCall + PluginImporter.SetCompatibleWithEditor to activate only the correct version's DLL on editor load. Also deletes legacy DLLs outside valid folders. Origin: ConsolePro. File: Recip
  ORIG2: Recipe: IEditorUpdate [InitializeOnLoad] dispatch (RCP-editor) :: How to implement an editor-time update loop without each system hooking EditorApplication.update independently | approach: IEditorUpdate interface + static subscriber list + single [InitializeOnLoad] dispatcher | origin: Gaskellgames/GgCore | file: Recipes/editor/how-do-you-implement-an-editor-time-
  ORIG3: Recipe: Editor settings migration via partial class + System.Version (editor) :: Store version string in settings ScriptableObject. On load, compare with System.Version and run ordered migration methods per boundary. Isolate migrations in a partial class. [Obsolete] on methods accessing removed fields suppresses warnings. Origin: CodeStage/Maintainer. File: Recipes/editor/how-do

### 135 [C--Voodoo-Paper2] Service Access Vulnerabilities & Reentrancy Risks
id=497652e7398b7ba6 folded=2 minCos=0.802
HARD(2): 436 | 458
soft(2): IsRegistered( | EnemyTrain.cs: ~436,~458
MERGED: Ungated service access, due to ServiceLocator patterns (used >50 times without null/registered guards), creates systemic vulnerability and breaks during mode/scene transitions; audit read sites for protection gaps. Reentrancy risks arise from TOCTOU vulnerabilities using `IsRegistered` before `Get`, especially during unregistration by `OnApplicationPause` and synchronous Quantum ticks impacting services, causing cras
  ORIG1: Ungated service access creates systemic vulnerability :: ServiceLocator patterns used 50+ times without null/registered guards signal tight coupling that breaks under mode/scene transitions. Audit for protection gaps at read sites.
  ORIG2: Reentrancy Risks & Scene-Scoped Service Access Guarding :: Reentrancy risks stem from Time-of-Check to Time-of-Use (TOCTOU) vulnerabilities in guard-then-access patterns using `IsRegistered` before `Get`, especially during unregistration by `OnApplicationPause` and synchronous Quantum ticks impacting services; this invalidates atomicity, causing crashes in 

### 136 [C--Fran-RumbleEditorTools] GlobalObjectId Serialization & Hot-Reload Field Injection
id=ea2e67a7cdcf3209 folded=2 minCos=0.838
HARD(2): UnpackForPrefab | RCP
soft(1): Recipes/editor/how-do-you-serialize-a-globalobjectid-reference.md
MERGED: [Serializable] struct mirroring GlobalObjectId uses two longs (targetObject, targetPrefab), cast with unchecked((long)) for dictionary key usage; used for scene object tracking when identifierType is 2. Dictionary<object, ExpandoObject> acts as a sidecar store enabling patched methods to read/write hot-reloaded fields via per-type factory delegates, circumventing .NET limitations. Large internal types and `EditorWind
  ORIG1: Recipe: GlobalID serializable struct wrapping GlobalObjectId (RCP-editor/how-do-you-serialize-a-globalobjectid-reference) :: Wrap GlobalObjectId in a [Serializable] struct with a string backing field and lazy-parsed _goid. UnpackForPrefab XORs targetObjectId and targetPrefabId to recover edit-mode fileId for play-mode prefab bookmarks. | origin: vInspector | file: Recipes/editor/how-do-you-serialize-a-globalobjectid-refer
  ORIG2: GlobalObjectId Serialization and Hot-Reload Field Injection :: A [Serializable] struct mirroring GlobalObjectId uses two longs (targetObject, targetPrefab), cast with unchecked((long)) to prevent overflow; this enables its use as a dictionary key and in serialized data for scene object tracking across domain reloads when identifierType is 2. A Dictionary<object

### 137 [global] Particle System Modification Workflow & Quirks
id=0e9c171f1614d24b folded=3 minCos=0.855
HARD(2): EmissionModules | and affects serialization within the
soft(3): C:	ran_Unity
ity-workflow-optimization | C:\Fran_Unity\unity-workflow-optimization | Fran_Unity
MERGED: When serializing gradients, use `Gradient.SetKeys(colorKeys, alphaKeys)` to atomically update color and alpha keys (documented in `Knowledge/serialization/gradientcolorkeys-and-alphakeys-read-only-use.md` within the `C:ran_Unityity-workflow-optimization` repository). Prevent silent failures by calling `particleSystem.Stop()` before modifying module properties; restore `isPaused`, `isPlaying`, and `isStopped` flags la
  ORIG1: Particle System Camera Sync, Volume Parameter Access & Preview Isolation :: To synchronize a particle system with the camera, cache `Camera.main` in `Initialize` and move the particle transform to the camera's position each frame; access post-process volume parameters by reading `VolumeManager.instance.stack.GetComponent<T>()` for O(1) performance. `ParticleSystem.main` ret
  ORIG2: Particle System Module Modification Workflow :: When serializing or restoring Particle Systems, always call `particleSystem.Stop()` before modifying any module properties to prevent silent failures; restore the `isPaused`, `isPlaying`, and `isStopped` flags last. EmissionModule bursts are handled by allocating a Burst array of size `burstCount`, 
  ORIG3: Particle System Gradient Modification Quirks :: When serializing gradients in Unity, use `Gradient.SetKeys(colorKeys, alphaKeys)` to atomically write both color and alpha key arrays; assigning only `colorKeys` will not update the associated alpha keys. Directly assigning a `Color` to `ParticleSystem.main.startColor` silently converts the gradient

### 138 [C--Fran-Voodoo-Magic] Card Rendering and Starfield Generation Differences
id=98e7009dc386ddc9 folded=2 minCos=0.879
HARD(2): MaskableGraphic | WHY
soft(1): Vector2/Rect
MERGED: The Stars card uses shader-material Images (StarTwinkle procedural rendering) and atlas sprites; Tower card uses atlas sprites (Cloud A, Thunders, Tower Bricks) layered over a flat sky quad GameObject. Atlas binding failures cause the sky quad to become visible as a solid blue box. StarfieldGenerator.GenerateStars(int seed, int count, Rect bounds, float sizeMin, float sizeMax) generates StarInstance[] using System.Ra
  ORIG1: Starfield Generation, Rendering, Script Organization, and Conventions :: StarfieldGenerator.GenerateStars(int seed, int count, Rect bounds, float sizeMin, float sizeMax) returns StarInstance[] using System.Random; it has Vector2/Rect dependencies and generates procedural data (positions, phases) separately from MaskableGraphic rendering for edit-mode unit testing and dec
  ORIG2: Card Rendering Architecture Differences :: Stars card utilizes a layered architecture of shader-material Images (StarTwinkle procedural rendering) and atlas sprites, ensuring resilience against atlas binding failures; Tower card relies entirely on atlas sprites (Cloud A, Thunders, Tower Bricks) layered over a flat sky quad fill. The solid bl

### 139 [C--Fran-Automatic-Encyclopedias] Batch Processing Failure at Batch 17 & Recovery Procedures
id=7ff28475e164afff folded=2 minCos=0.813
HARD(1): HIGH
soft(4): analyze-plan --skip-existing | flow.yaml | serial_processing | recovery_flag2
MERGED: Book processing batch jobs consistently fail at batch 17 due to authentication/rate-limiting issues. The `pipeline-result.json` file tracks categorization results (`ok`, `failed`, `missing`), and automatic re-runs are preferred over manual recovery, aligning with individual book processing routines. Batch parallelism allows for 23+ concurrent per-book pipelines, managed by the `fork_analyze` architecture which handle
  ORIG1: Batch 17 rate-limit auth failure :: Book processing batch jobs consistently fail at batch 17 due to authentication/rate-limiting issues. This is a recurring failure point observed across multiple book runs.
  ORIG2: Batch Processing Recovery and Parallelism :: {"batch_runs": {"categorization": ["ok", "failed", "missing"]}, "result_file": "pipeline-result.json", "retry": "parallel retry of failed/missing books", "automatic_re_runs": "preferred over manual recovery, aligns with individual book processing routine"}, "permissions": {"declaration": "flow.yaml"

### 140 [C--Fran-LLM-Workflow-Optimization] Flow Directory Conventions, Toolkit Sessions, and Tool Management
id=b89627115e20648a folded=2 minCos=0.883
HARD(1): ^python .*Encyclopedias Subproject
soft(4): flow-shared/agents/*.md | <PROJECT_ROOT>\C:\Fran\Automatic Encyclopedias\pipeline\ | flow-state.env | PROJECT_ROOT
MERGED: The repository uses `.flow/` for plan documentation; transient pipeline run artifacts reside in `.flow/tdd/` and `.flow/flow-toolkit/`, which are not committed. Transcript processing tasks avoid committing `baseline/`, `outputs/`, and personal session logs to git. The `llm-pipeline` commits `.md` artifacts, reads the feature branch name from `tasks.json`, creates it if needed, switches to it; modes 2 (in-session sequ
  ORIG1: Flow Toolkit Session Hierarchy, Slug Derivation, Tool Management & YAML Path Validation :: Flow-toolkit sessions use a two-level directory structure `.flow/flow-toolkit/<flow-name>/`, differing from other flows' three-level hierarchy; worktree paths generate slugs that differ from main repository slugs, requiring `--project-slug` overrides or probing multiple slug variants (main-slug-YYYY
  ORIG2: .flow/ Directory and Workflow Conventions :: The repository tracks a single `.flow/` directory for plan documentation; pipeline run artifacts reside in `.flow/tdd/` and `.flow/flow-toolkit/`, which are transient and should never be committed. Transcript processing tasks must avoid committing transcript-derived artifacts (baseline/, outputs) or

### 141 [global] SyntaxAnnotation & ParseExpression Usage
id=f37352a5468c3717 folded=2 minCos=0.875
HARD(1): ToString
soft(2): node.ToString().Replace("OuterClass.", | node.ToString
MERGED: Use `CompilationUnitSyntax.WithAdditionalAnnotations(new SyntaxAnnotation(key, value))` to embed metadata like preprocessor symbols, source origin, and pass number within a syntax tree; annotations persist through `With*` mutations but are lost during re-parsing. Metadata embedding avoids wrapper types and thread-unsafe static state. `SyntaxFactory.ParseExpression` is safe for parsing small, already-valid expression 
  ORIG1: SyntaxAnnotation carries pipeline metadata through tree transformations :: Call CompilationUnitSyntax.WithAdditionalAnnotations(new SyntaxAnnotation(key, value)) to embed metadata (preprocessor symbols, source origin, pass number) into a syntax tree. Annotations survive With* mutations but not re-parsing. Avoids wrapper types or thread-unsafe static state.
  ORIG2: SyntaxFactory.ParseExpression safe for small expression fragments :: Calling SyntaxFactory.ParseExpression on an already-valid short expression (e.g., stripping a qualifier: `node.ToString().Replace("OuterClass.", "")`). Fast and syntactically safe when the fragment is guaranteed valid. Do not use for untrusted input or large sources.

### 142 [global] Unity Menu Item Disabling via MenuItem Validator
id=0be5bba9ba6747b6 folded=2 minCos=0.884
HARD(1): RCP
soft(2): Knowledge/editor/disable-a-unity-menu-item-at-runtime-via-menuitem.md | Recipes/editor/how-do-you-grey-out-or-hide-a-menuitem-when-its.md
MERGED: To disable a Unity menu item at runtime, use a `[MenuItem(path, true)]` validator returning a boolean value based on a static flag like `_activeFlag`. Greying out or hiding a menu item is achieved by returning `false` from the validator function, which executes before the menu paint phase and must be O(1) in complexity. The `path` argument to `[MenuItem]` must be a compile-time constant; Unity does not provide a `Men
  ORIG1: BP-editor/disable-a-unity-menu-item-at-runtime-via-menuitem — Disable a Unity menu item at runtime via [MenuItem] validator + static bool :: To grey-out a menu item at runtime, use [MenuItem(path, true)] validator returning !_activeFlag. Flip the static bool from activation/deactivation. No Menu.SetEnabled API exists. Path must be a compile-time const. | domain:editor | file: Knowledge/editor/disable-a-unity-menu-item-at-runtime-via-menu
  ORIG2: Recipe: [MenuItem] validator method for conditional menu item hiding/disabling (RCP-editor/how-do-you-grey-out-or-hide-a-menuitem-when-its) :: Pair [MenuItem(path, false, priority)] with [MenuItem(path, true, priority)] validator returning bool. Validator runs before menu paint — return false to grey out/hide. Must be fast (O(1)). Same pattern works for CONTEXT/TypeName/Action right-click validators that receive MenuCommand. origin: Easy S

### 143 [global] Safe List Iteration, BT Resumption & Cleanup Procedures
id=6dc96063ffbb215d folded=3 minCos=0.788
HARD(1): within the repository at
soft(2): C:ran_Unity
ity-workflow-optimization | Fran_Unity
MERGED: Safely remove items from a `List<T>` during iteration by iterating backward (Count-1 to 0) and calling `RemoveAt(i)` to avoid index shifting and allocations; see `Recipes/monobehaviours/backward-iteration-self-removing-list.md` in repository `C:‫ran_Unityity-workflow-optimization`. For BehaviorTree (BT) Sequence or Selector nodes, store a `_currentIndex` to prevent re-executing completed siblings each frame and avoid
  ORIG1: Safe List Iteration and BT Sequence/Selector Resumption :: To safely remove items from a `List<T>` while iterating each frame without index errors or skipped entries, iterate backward (Count-1 to 0) and call `RemoveAt(i)` on completion; this avoids index shifting and allocations. This technique is documented in `Recipes/monobehaviours/backward-iteration-sel
  ORIG2: Behavior Tree Decorator Reset & Cleanup Procedures :: To prevent permanent blocking of cooldown decorators during parent tree resets, the `Reset()` method must clear the `_elapsed` timer to zero; this ensures subsequent activations start fresh. When a Behavior Tree Timeout decorator expires, it should call its child's `Abort()` method before calling `R
  ORIG3: Reverse-Index Iteration for Target Search and Child Destruction :: To efficiently find the closest alive target using reverse-index iteration, combine dead-target pruning with a single O(n) loop that compares targets by sqrMagnitude and safely removes dead entries via RemoveAt(i); this approach originated in Behavior Designer Tactical. When destroying all child obj

### 144 [global] Unity Sprite Scaling and Pivot Normalization
id=b86e29c9d3459d50 folded=2 minCos=0.856
HARD(0): —
soft(4): BP-shaders/scale-vertex-position-by-unityspritepropsxy-in-unity6 | Knowledge/shaders/scale-vertex-position-by-unityspritepropsxy-in.md | BP-serialization/spritepivot-is-in-pixels-normalise-to-0-1-range | Knowledge/serialization/spritepivot-is-in-pixels-normalise-to-0-1-range.md
MERGED: In Unity 6 (version 6000.0+), sprite shaders require multiplying localPos.xy by unity_SpriteProps.xy before TransformObjectToHClip, as sprite dimensions are passed this way instead of being baked into the mesh; failure to do so renders sprites at 1x1 units without compile errors, gated by UNITY_VERSION >= 60000000. Sprite.pivot is expressed in pixels and must be divided by texture.width/height before use with Sprite.
  ORIG1: BP-shaders/scale-vertex-position-by-unityspritepropsxy-in-unity6 :: In Unity 6 (6000.0+) sprite shaders, multiply localPos.xy by unity_SpriteProps.xy before TransformObjectToHClip. Unity 6 passes sprite dimensions this way instead of baking into the mesh — omitting this renders all sprites at 1x1 units with no compile error. Gate on UNITY_VERSION >= 60000000. | doma
  ORIG2: BP-serialization/spritepivot-is-in-pixels-normalise-to-0-1-range :: Sprite.pivot is in pixels; divide by texture.width/height before passing to Sprite.Create(). Raw pixel value shifts origin by hundreds of pixels silently. | domain:serialization | file: Knowledge/serialization/spritepivot-is-in-pixels-normalise-to-0-1-range.md | repo: C:\Fran\_Unity\unity-workflow-o

### 145 [C--Fran-uber-db] Llama-Swap Embedding and Gemma Integration Configuration
id=04fb72abbf668226 folded=3 minCos=0.869
HARD(0): —
soft(7): migration_path | existing_models | embeddinggemma_gguf_availability | model_identifier_matching | llama_swap_key_format | ollama_key_format | batching_mapping
MERGED: llama-server.exe, deployed for phi-4-mini, supports --embedding, --pooling, and --embd-gemma-default flags to serve embeddinggemma models via llama-swap management; Llama-Swap arbitrates GPU VRAM using `llama-swap.exe -config config.yaml -listen 127.0.0.1:8080` with a default TTL of 300 seconds and model groups defined in `config.yaml`, including phi-4-mini and bge-reranker-v2-m3, requiring mxbai-embed-large for embe
  ORIG1: llama-server supports embedding and Gemma architecture flags :: llama-server.exe (deployed for phi-4-mini) supports --embedding, --pooling, --embd-gemma-default. Confirms technical feasibility of serving embeddinggemma models via llama-server under llama-swap management.
  ORIG2: Llama-Swap VRAM Arbitration and Configuration :: Llama-Swap, launched from C:\Fran\tools\llama-swap\ via `llama-swap.exe -config config.yaml -listen 127.0.0.1:8080`, arbitrates GPU VRAM between workloads like Ollama (llama-server.exe) and Uber-DB embedding calls by dynamically swapping models based on a TTL field (defaulting to 300 seconds). Each 
  ORIG3: Llama-Swap /v1/embeddings API Integration Details & Configuration :: { "embedding_models": ["--embeddings --pooling mean -c 2048 -ngl 999"], "ttl": 300, "response_shape": {"data": [{"embedding": [...]}]}, "provider_selection": "branching request/response logic", "embeddingconfig_type": "ollama-client.ts", "uberconfig_fields": ["maxInputChars", "prefixMode", "dim", "b