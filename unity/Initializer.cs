using System;
using System.IO;
using Newtonsoft.Json;
using UnityEngine;

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
    private float lobbyEndTime;
    private bool started;

    private void Start()
    {
        if (backend == null) backend = GetComponent<BackendConnector>();
        if (gameLogic == null) gameLogic = GetComponent<GameLogic>();

        cfg = LoadControl();
        backend.SetServerUrl(cfg.backendWsUrl);

        backend.OnConnected += HandleConnected;
        backend.OnUnityCreated += HandleUnityCreated;

        backend.Connect();
    }

    private void Update()
    {
        if (!started && Time.time >= lobbyEndTime)
        {
            StartMatch();
        }

        if (!started && Input.GetKeyDown(KeyCode.N))
        {
            StartMatch();
        }
    }

    private void HandleConnected()
    {
        backend.SendUnityCreate(new BackendConnector.UnityCreateMsg
        {
            gameType = cfg.gameType,
            location = cfg.location,
            teamCount = cfg.teamCount,
            allowedNumberOfPlayers = cfg.allowedNumberOfPlayers,
            requestedCode = GenerateRoomCode(cfg.roomCodeLength)
        });
    }

    private void HandleUnityCreated(string code)
    {
        lobbyEndTime = Time.time + cfg.lobbyDurationSeconds;
        gameLogic.Configure(cfg, backend, code);
        backend.SendPhase("join");
    }

    private void StartMatch()
    {
        if (started) return;
        started = true;
        backend.SendPhase("active");
        gameLogic.BeginGameplay();
    }

    private ControlConfig LoadControl()
    {
        var root = Directory.GetParent(Application.dataPath)?.FullName ?? Application.dataPath;
        var path = Path.Combine(root, "control.json");
        if (!File.Exists(path))
        {
            Debug.LogError("Missing control.json at project root");
            return new ControlConfig();
        }
        return JsonConvert.DeserializeObject<ControlConfig>(File.ReadAllText(path)) ?? new ControlConfig();
    }

    private string GenerateRoomCode(int length)
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
        var rng = new System.Random();
        var result = new char[Mathf.Max(4, length)];
        for (int i = 0; i < result.Length; i++) result[i] = chars[rng.Next(chars.Length)];
        return new string(result);
    }
}
