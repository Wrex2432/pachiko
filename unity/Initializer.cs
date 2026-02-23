using System;
using System.IO;
using Newtonsoft.Json;
using UnityEngine;

#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

public class Initializer : MonoBehaviour
{
    [Serializable]
    public class ControlConfig
    {
        public string gameType = "facechinko";
        public string location = "CINEMA_A";
        public int allowedNumberOfPlayers = 56;
        public int teamCount = 13;
        public int lobbyDurationSeconds = 30;
        public string backendWsUrl = "wss://api.prologuebymetama.com/ws";
        public int roomCodeLength = 4;
    }

    [SerializeField] private BackendConnector backend;
    [SerializeField] private GameLogic gameLogic;

    private ControlConfig cfg;

    // Lobby control
    private float lobbyEndTime = float.PositiveInfinity; // prevents instant-start
    private bool started = false;
    private bool sessionReady = false; // only true after unityCreated

    private void Start()
    {
        if (backend == null) backend = GetComponent<BackendConnector>();
        if (gameLogic == null) gameLogic = GetComponent<GameLogic>();

        cfg = LoadControl();

        if (backend == null)
        {
            Debug.LogError("[Initializer] Missing BackendConnector reference/component.");
            enabled = false;
            return;
        }

        if (gameLogic == null)
        {
            Debug.LogError("[Initializer] Missing GameLogic reference/component.");
            enabled = false;
            return;
        }

        backend.SetServerUrl(cfg.backendWsUrl);

        backend.OnConnected += HandleConnected;
        backend.OnUnityCreated += HandleUnityCreated;

        Debug.Log($"[Initializer] Boot: gameType={cfg.gameType}, location={cfg.location}, players={cfg.allowedNumberOfPlayers}, teams={cfg.teamCount}, lobby={cfg.lobbyDurationSeconds}s");
        backend.Connect();
    }

    private void OnDestroy()
    {
        // Cleanly unsubscribe (prevents double-calls if object reloads)
        if (backend != null)
        {
            backend.OnConnected -= HandleConnected;
            backend.OnUnityCreated -= HandleUnityCreated;
        }
    }

    private void Update()
    {
        // Do nothing until we actually have a session code from backend
        if (!sessionReady) return;

        if (!started && Time.time >= lobbyEndTime)
        {
            Debug.Log("[Initializer] Lobby timer elapsed → starting match.");
            StartMatch();
            return;
        }

        if (!started && IsManualStartPressed())
        {
            Debug.Log("[Initializer] Manual start pressed (N) → starting match.");
            StartMatch();
            return;
        }
    }

    private bool IsManualStartPressed()
    {
#if ENABLE_INPUT_SYSTEM
        // Input System (recommended in Unity 6+ projects)
        return Keyboard.current != null && Keyboard.current.nKey.wasPressedThisFrame;
#else
        // Legacy Input Manager
        return Input.GetKeyDown(KeyCode.N);
#endif
    }

    private void HandleConnected()
    {
        // When connected, we request the backend to create a session for this Unity host.
        var requestedCode = GenerateRoomCode(cfg.roomCodeLength);

        Debug.Log($"[Initializer] Connected → sending unityCreate (requestedCode={requestedCode})");

        backend.SendUnityCreate(new BackendConnector.UnityCreateMsg
        {
            gameType = cfg.gameType,
            location = cfg.location,
            teamCount = cfg.teamCount,
            allowedNumberOfPlayers = cfg.allowedNumberOfPlayers,
            requestedCode = requestedCode
        });
    }

    private void HandleUnityCreated(string code)
    {
        // This is the moment the session is truly ready.
        sessionReady = true;
        started = false;

        // Start lobby countdown only now (prevents instant-start bug).
        lobbyEndTime = Time.time + Mathf.Max(1, cfg.lobbyDurationSeconds);

        Debug.Log($"[Initializer] unityCreated → code={code}, lobbyEndsIn={cfg.lobbyDurationSeconds}s (t={lobbyEndTime:0.00})");

        // Configure game systems now that we have the official code.
        gameLogic.Configure(cfg, backend, code);

        // Tell backend we are in join phase.
        backend.SendPhase("join");
    }

    private void StartMatch()
    {
        // Guard: must have a created session
        if (!sessionReady) return;

        // Guard: only start once
        if (started) return;

        started = true;

        Debug.Log("[Initializer] Match starting → phase=active, BeginGameplay()");
        backend.SendPhase("active");
        gameLogic.BeginGameplay();
    }

    private ControlConfig LoadControl()
    {
        var root = Directory.GetParent(Application.dataPath)?.FullName ?? Application.dataPath;
        var path = Path.Combine(root, "control.json");

        if (!File.Exists(path))
        {
            Debug.LogError("[Initializer] Missing control.json at project root. Using defaults.");
            return new ControlConfig();
        }

        try
        {
            var json = File.ReadAllText(path);
            var parsed = JsonConvert.DeserializeObject<ControlConfig>(json);
            return parsed ?? new ControlConfig();
        }
        catch (Exception e)
        {
            Debug.LogError($"[Initializer] Failed to read/parse control.json. Using defaults. Error: {e.Message}");
            return new ControlConfig();
        }
    }

    private string GenerateRoomCode(int length)
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O/1/0 confusion
        var rng = new System.Random();

        var finalLen = Mathf.Max(4, length);
        var result = new char[finalLen];

        for (int i = 0; i < result.Length; i++)
            result[i] = chars[rng.Next(chars.Length)];

        return new string(result);
    }
}