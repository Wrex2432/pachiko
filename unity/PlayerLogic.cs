using UnityEngine;
using UnityEngine.UI;

public class PlayerLogic : MonoBehaviour
{
    [SerializeField] private string uid;
    [SerializeField] private string playerName;
    [SerializeField] private int teamIndex;
    [SerializeField] private Renderer ballRenderer;
    [SerializeField] private Text nameTopText;
    [SerializeField] private Text teamBottomText;

    private static readonly Color[] TeamColors = new Color[]
    {
        new(1.00f,0.65f,0.00f), new(0.00f,0.50f,0.00f), new(0.00f,0.00f,1.00f), new(0.50f,0.00f,0.50f),
        new(1.00f,0.87f,0.00f), new(0.29f,0.00f,0.51f), new(0.00f,0.66f,0.42f), new(1.00f,0.94f,0.84f),
        new(0.25f,0.41f,0.88f), new(0.96f,0.82f,0.24f), new(0.20f,0.80f,0.20f), new(0.54f,0.81f,0.94f),
        new(1.00f,0.00f,0.00f)
    };

    private static readonly string[] TeamNames = new string[]
    {
        "Team Dana & Greggy", "Team Mond & Saeid", "Team Jill & Alvin", "Team Sam & Ninya",
        "Team Ynna", "Team Jasper", "Team Jordy", "Team MEDIA", "Team STRAT", "Team HR & ADMIN",
        "Team FINANCE", "Team Micco", "Team Bev"
    };

    public string UID => uid;
    public int TeamIndex => teamIndex;

    public void Init(string newUid, string newName, int newTeamIndex)
    {
        uid = newUid;
        playerName = newName;
        teamIndex = Mathf.Clamp(newTeamIndex, 0, TeamColors.Length - 1);
        RefreshVisuals();
    }

    private void Awake() => RefreshVisuals();

    private void RefreshVisuals()
    {
        if (ballRenderer == null) ballRenderer = GetComponentInChildren<Renderer>();
        if (ballRenderer != null) ballRenderer.material.color = TeamColors[teamIndex];

        if (nameTopText != null) nameTopText.text = playerName;
        if (teamBottomText != null) teamBottomText.text = TeamNames[teamIndex];
    }
}
