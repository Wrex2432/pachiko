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
        new(0.95f,0.26f,0.21f), new(0.91f,0.12f,0.39f), new(0.61f,0.15f,0.69f), new(0.40f,0.23f,0.72f),
        new(0.25f,0.32f,0.71f), new(0.13f,0.59f,0.95f), new(0.01f,0.66f,0.96f), new(0.00f,0.74f,0.83f),
        new(0.00f,0.59f,0.53f), new(0.30f,0.69f,0.31f), new(0.55f,0.76f,0.29f), new(1.00f,0.60f,0.00f),
        new(1.00f,0.34f,0.13f), new(0.47f,0.33f,0.28f)
    };

    public string UID => uid;
    public int TeamIndex => teamIndex;

    public void Init(string newUid, string newName, int newTeamIndex)
    {
        uid = newUid;
        playerName = newName;
        teamIndex = Mathf.Clamp(newTeamIndex, 0, 13);
        RefreshVisuals();
    }

    private void Awake() => RefreshVisuals();

    private void RefreshVisuals()
    {
        if (ballRenderer == null) ballRenderer = GetComponentInChildren<Renderer>();
        if (ballRenderer != null) ballRenderer.material.color = TeamColors[teamIndex];

        if (nameTopText != null) nameTopText.text = playerName;
        if (teamBottomText != null) teamBottomText.text = $"TEAM {teamIndex + 1}";
    }
}
